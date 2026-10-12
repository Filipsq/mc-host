# Node agent

Runs on each game host and manages one Docker container per Minecraft server for the web panel.
It talks to Docker over `/var/run/docker.sock` with no extra dependencies.

It also listens on the Java port (25565) and routes each player by the address they typed
(`ekipa.mchost.pl`) to that server's container. If the server is asleep it shows "asleep, join to
wake it" in the server list and starts it when someone tries to join. Point a wildcard DNS record
(`*.mchost.pl`) at the host.

Free servers sleep after `IDLE_MINUTES` with nobody online: Java through the image's built-in
autostop, Bedrock through the agent watching join/leave lines in the console.

```bash
AGENT_TOKEN=some-long-secret go run .     # listens on :8081
go test ./...
```

| Env | Default | |
| --- | --- | --- |
| `AGENT_TOKEN` | (required) | Shared secret; the panel sends it as `Authorization: Bearer …` |
| `AGENT_ADDR` | `:8081` | Listen address. Keep it private (firewall or VPN), never public |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `GAME_ADDR` | `:25565` | Public Java port the router listens on |
| `IDLE_MINUTES` | `5` | How long a free server may sit empty before sleeping |
| `STATE_DIR` | `./state` | Remembers which servers were stopped by their owner (so players can't wake them) |
| `BACKUP_DIR` | `./backups` | Where backups are kept: `<server id>/<UTC time>.tar.gz` |
| `BACKUP_MOUNT` | `BACKUP_DIR` | The same place as Docker sees it (a host path or a volume name), for the helper containers that pack and unpack worlds |
| `VOLUMES_DIR` | `/var/lib/docker/volumes` | Where Docker keeps volumes, mounted into the agent at the same path, for the file manager. Without it the file endpoints answer 503 |
| `UPLOAD_MAX_MB` | `1024` | The biggest file the file manager takes; a zip may unpack to 4 times this |
| `MIN_FREE_DISK_MB` | `4096` | Uploads and unzipping stop short of leaving less disk free than this |
| `MEMORY_LIMIT_MB` | `0` (no limit) | Plan memory all servers may hold together. Paid servers hold theirs even when stopped (unless suspended); a free server only while awake, and it isn't started when it doesn't fit |

## API

| Method | Path | |
| --- | --- | --- |
| POST | `/servers` | Create and start a server: `{id, name, edition: JAVA\|BEDROCK, memoryMb, cpus, port, maxPlayers, version, hostname, autostop, backupsKept, gameMode, difficulty, motd, pvp, whitelist, whitelistPlayers, kind, modpack, modpackVersion}` |
| PUT | `/servers/{id}` | Rebuild the container with a new spec (plan or settings change), keeping the world. With `?start=if-running` a stopped or sleeping server stays off |
| GET | `/servers/{id}` | Container state, health, and when stopped why: `sleeping`, `stopped` or `crashed` |
| POST | `/servers/{id}/start`, `/stop` | Stop waits up to 60 s so the world is saved; `/stop?reason=suspended` also gives back the server's memory until it's renewed. Starting a free server that doesn't fit returns 503 `{"error":"full"}` |
| DELETE | `/servers/{id}` | Removes the container, its world volume and its backups |
| GET | `/servers/{id}/logs` | Console as Server-Sent Events (last 200 lines, then live) |
| POST | `/servers/{id}/command` | `{command}`; Java via RCON, Bedrock via stdin |
| GET | `/servers/{id}/backups` | `{keep, backups: [{name, size, createdAt}]}`, newest first |
| POST | `/servers/{id}/backups` | Back up now. 403 when the plan has no backups |
| GET | `/servers/{id}/backups/{name}` | Download a backup (`.tar.gz` of the server's `/data`) |
| POST | `/servers/{id}/backups/{name}/restore` | Replace the world with a backup; a running server is stopped and started again |
| GET | `/servers/{id}/files?path=` | A folder of the server's files: `{path, entries: [{name, type: dir\|file\|link\|other, size, modified}], truncated}`, folders first |
| GET | `/servers/{id}/files/content?path=` | Download a file. With `&max=` a bigger one is refused with 413 |
| PUT | `/servers/{id}/files/content?path=` | Save the body as the file (upload or edit), making missing folders |
| POST | `/servers/{id}/files/mkdir?path=`, `/files/rename?path=&to=`, `/files/unzip?path=&to=` | Make a folder; rename or move (never over an existing name); unpack a zip into `to` (by default its own folder) |
| DELETE | `/servers/{id}/files?path=` | Delete a file or a folder with everything in it |

Java servers run what `kind` says: `vanilla` (Paper, the default), `skyblock` or `oneblock`
(Paper with the BentoBox plugins from Modrinth, on the newest Minecraft version they all support),
or `modpack` (the Modrinth mod pack `modpack` at version ID `modpackVersion`, on its Minecraft
`version`). Paper servers also get the owner's `plugins` (Modrinth slugs or project IDs) with the
plugins they need; one without a build for the server's version is skipped, and a plugin taken
off the list is deleted the next time the server starts.

Paths in the file endpoints are relative to the server's `/data` (its volume). The agent opens the
volume with `os.Root`, so neither `..` nor a symlink reaches outside it. Changes answer 409
`busy` during a backup or restore of the same server, and 507 when the disk is nearly full.

Servers whose plan keeps backups (`backupsKept`) are backed up once a day, if they have run since
their last backup. A running server's saving is paused while its world is copied. Only the newest
`backupsKept` are kept.

Each server gets the `itzg/minecraft-server` (Paper, with the Java its version needs: 17 for
1.17–1.19, 21 for 1.20–1.21.11, 25 for 26.1 onwards) or `itzg/minecraft-bedrock-server` image,
a memory and CPU limit from its plan, its world in a `mc-<id>` volume, and up to 3 automatic
restarts after a crash.
