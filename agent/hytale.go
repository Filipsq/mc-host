package main

import (
	"errors"
	"fmt"
	"regexp"
	"runtime"
	"time"
)

// Hytale servers run on a plain Java 25 image with our own script. On every
// start the script asks Hytale's downloader for the newest version and, if
// it's new, fetches the server and its Assets.zip into the server's volume
// (Server/ and Assets.zip, about 3 GB, counted toward the disk limit), then
// starts the server in Server/, where it keeps its worlds (universe/),
// config.json, mods/ and logs/. Players connect straight to the server's
// port over UDP (QUIC).
//
// Every Hytale server must be signed in with an account that owns the game.
// The site signs in the admin's account once and hands each new container a
// fresh game session (HYTALE_SERVER_SESSION_TOKEN / _IDENTITY_TOKEN, valid an
// hour, which the server itself then keeps renewing) and the downloader's
// credentials. Without them the server still starts, and its owner can sign it
// in themselves with /auth login device in the console.

const (
	hytaleImage = "eclipse-temurin:25-jdk" // the JDK, for the small Java helper below
	hytalePort  = "5520/udp"
)

// hytaleSupported reports whether this machine can run Hytale: the server runs
// anywhere Java does, but Hytale's downloader is built for x86 only.
func hytaleSupported() bool { return runtime.GOARCH == "amd64" }

// hytaleAuth is what the site sends for a Hytale server: a game session for
// the admin's account and the downloader's sign-in. All empty when no account
// is connected.
type hytaleAuth struct {
	SessionToken  string `json:"sessionToken"`
	IdentityToken string `json:"identityToken"`
	OwnerUUID     string `json:"ownerUuid"`
	// The downloader's OAuth sign-in, as its .hytale-downloader-credentials.json holds it.
	DownloaderAccess  string `json:"downloaderAccess"`
	DownloaderRefresh string `json:"downloaderRefresh"`
	DownloaderExpires int64  `json:"downloaderExpires"` // Unix seconds
}

var (
	validToken = regexp.MustCompile(`^[A-Za-z0-9._~+/=-]*$`)
	validUUID  = regexp.MustCompile(`^([0-9a-fA-F-]{32,36})?$`)
)

func (req *createRequest) validateHytale() error {
	switch {
	case !validID.MatchString(req.ID):
		return errors.New("invalid id")
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0 || req.DiskMb < 0:
		return errors.New("invalid memoryMb, cpus, port or diskMb")
	case !hytaleSupported():
		return errors.New("Hytale servers need an x86 (amd64) machine")
	case len(req.Plugins) > 0 || req.Kind != "" && req.Kind != "vanilla":
		return errors.New("Hytale servers take no plugins from the panel")
	case req.Whitelist || req.Crossplay || req.offline() || req.Modpack != "" || req.Hostname != "" || req.VoiceHost != "":
		return errors.New("whitelist, crossplay, onlineMode, modpacks, hostnames and voice are Minecraft only")
	}
	if h := req.Hytale; h != nil {
		for _, t := range []string{h.SessionToken, h.IdentityToken, h.DownloaderAccess, h.DownloaderRefresh} {
			if len(t) > 8192 || !validToken.MatchString(t) {
				return errors.New("invalid Hytale token")
			}
		}
		if !validUUID.MatchString(h.OwnerUUID) {
			return errors.New("invalid Hytale owner UUID")
		}
	}
	req.Kind, req.Version, req.Seed, req.LevelType, req.Level = "vanilla", "LATEST", "", "", ""
	return nil
}

// hytaleFetch is a small Java program (run from source, no compiling) that
// downloads a file or unpacks a zip: the image has neither curl nor unzip.
const hytaleFetch = `import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.zip.*;

public class Fetch {
  public static void main(String[] a) throws Exception {
    if (a[0].equals("get")) {
      var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();
      var res = client.send(HttpRequest.newBuilder(URI.create(a[1])).build(), HttpResponse.BodyHandlers.ofFile(Path.of(a[2])));
      if (res.statusCode() != 200) { System.err.println("HTTP " + res.statusCode() + " from " + a[1]); System.exit(1); }
      return;
    }
    Path dest = Path.of(a[2]).toAbsolutePath().normalize();
    try (var zip = new ZipInputStream(new BufferedInputStream(Files.newInputStream(Path.of(a[1]))))) {
      ZipEntry e;
      while ((e = zip.getNextEntry()) != null) {
        Path p = dest.resolve(e.getName()).normalize();
        if (!p.startsWith(dest)) throw new IOException("bad zip entry " + e.getName());
        if (e.isDirectory()) { Files.createDirectories(p); continue; }
        Files.createDirectories(p.getParent());
        Files.copy(zip, p, StandardCopyOption.REPLACE_EXISTING);
      }
    }
  }
}
`

// hytaleScript gets the game up to date and starts it, with its console on a
// named pipe (as Terraria's) and docker stop turned into the server's "stop".
const hytaleScript = `set -u
mkdir -p /data/.mchost/downloader /tmp/fetch
printf '%s' "$MCHOST_FETCH" > /tmp/fetch/Fetch.java
fetch() { java /tmp/fetch/Fetch.java "$@"; }
dl=/data/.mchost/downloader
bin=$(ls "$dl"/hytale-downloader-linux* 2>/dev/null | head -n 1)
if [ -z "$bin" ]; then
  echo "[mchost] Downloading Hytale's downloader"
  if fetch get https://downloader.hytale.com/hytale-downloader.zip /tmp/downloader.zip && fetch unzip /tmp/downloader.zip "$dl"; then
    bin=$(ls "$dl"/hytale-downloader-linux* 2>/dev/null | head -n 1)
  fi
  rm -f /tmp/downloader.zip
fi
[ -n "$bin" ] && chmod +x "$bin"
if [ -n "$MCHOST_DL_ACCESS" ]; then
  printf '{"access_token":"%s","refresh_token":"%s","expires_at":%s,"branch":"release"}\n' \
    "$MCHOST_DL_ACCESS" "$MCHOST_DL_REFRESH" "$MCHOST_DL_EXPIRES" > "$dl/.hytale-downloader-credentials.json"
fi
if [ -n "$bin" ] && [ -s "$dl/.hytale-downloader-credentials.json" ]; then
  cd "$dl"
  latest=$("$bin" -print-version -skip-update-check 2>/dev/null | tail -n 1 | tr -d '\r')
  have=$(cat /data/.mchost/version 2>/dev/null || true)
  if [ -n "$latest" ] && { [ "$latest" != "$have" ] || [ ! -f /data/Server/HytaleServer.jar ]; }; then
    echo "[mchost] Downloading Hytale $latest (about 3 GB, the first time takes a few minutes)"
    if "$bin" -download-path /data/.mchost/game.zip -skip-update-check && fetch unzip /data/.mchost/game.zip /data; then
      printf '%s\n' "$latest" > /data/.mchost/version
      echo "[mchost] Hytale $latest is ready"
    else
      echo "[mchost] The download failed; starting the version downloaded before, if any"
    fi
    rm -f /data/.mchost/game.zip
  else
    echo "[mchost] Hytale ${have:-?} is the newest version"
  fi
  # The site's sign-in is good for this start; the downloader mustn't keep an old copy.
  rm -f "$dl/.hytale-downloader-credentials.json"
else
  echo "[mchost] No Hytale account is connected for downloads (admin panel → Hytale)"
fi
if [ ! -f /data/Server/HytaleServer.jar ]; then
  echo "[mchost] Hytale isn't downloaded yet, so the server can't start. The admin needs to connect a Hytale account; then press Start again."
  exit 1
fi
if [ -z "${HYTALE_SERVER_SESSION_TOKEN:-}" ]; then
  echo "[mchost] No Hytale account signs this server in: players can't join until you type /auth login device here and sign in with an account that has Hytale."
fi
rm -f /tmp/console && mkfifo /tmp/console
exec 3<>/tmp/console
cd /data/Server
set -- -Xms512m -Xmx"$MCHOST_HEAP_MB"m
[ -f HytaleServer.aot ] && set -- "$@" -XX:AOTCache=HytaleServer.aot
set -- "$@" -jar HytaleServer.jar --assets ../Assets.zip --bind 0.0.0.0:5520
[ -n "$MCHOST_OWNER_UUID" ] && set -- "$@" --owner-uuid "$MCHOST_OWNER_UUID"
java "$@" <&3 &
pid=$!
trap 'echo stop >&3' TERM INT
code=0
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done
exit "$code"
`

// hytaleSpec is a Hytale server's environment and command.
func hytaleSpec(req createRequest) (env []string, entrypoint []string) {
	h := req.Hytale
	if h == nil {
		h = &hytaleAuth{}
	}
	env = []string{
		"MCHOST_FETCH=" + hytaleFetch,
		fmt.Sprintf("MCHOST_HEAP_MB=%d", req.MemoryMb),
		"MCHOST_OWNER_UUID=" + h.OwnerUUID,
		"MCHOST_DL_ACCESS=" + h.DownloaderAccess,
		"MCHOST_DL_REFRESH=" + h.DownloaderRefresh,
		fmt.Sprintf("MCHOST_DL_EXPIRES=%d", h.DownloaderExpires),
		"HYTALE_SERVER_SESSION_TOKEN=" + h.SessionToken,
		"HYTALE_SERVER_IDENTITY_TOKEN=" + h.IdentityToken,
	}
	return env, []string{"/bin/bash", "-c", hytaleScript}
}

// hytaleCommand types a command into the server's console, as Terraria's.
func hytaleCommand(cmd string) []string { return terrariaCommand(cmd) }

// udpHealthcheck calls the server healthy once it listens on its UDP port
// inside the container (after a first download, which takes a while).
func udpHealthcheck(port int, start time.Duration) map[string]any {
	return map[string]any{
		"Test":        []string{"CMD-SHELL", fmt.Sprintf("cat /proc/net/udp /proc/net/udp6 2>/dev/null | grep -q ':%04X '", port)},
		"Interval":    int64(10 * time.Second),
		"Timeout":     int64(5 * time.Second),
		"StartPeriod": int64(start),
		"Retries":     3,
	}
}
