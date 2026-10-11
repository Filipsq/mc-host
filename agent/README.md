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

## API

| Method | Path | |
| --- | --- | --- |
| POST | `/servers` | Create and start a server: `{id, name, edition: JAVA\|BEDROCK, memoryMb, cpus, port, maxPlayers, version, hostname, autostop}` |
| PUT | `/servers/{id}` | Rebuild the container with a new spec (plan change), keeping the world |
| GET | `/servers/{id}` | Container state, health, and when stopped why: `sleeping`, `stopped` or `crashed` |
| POST | `/servers/{id}/start`, `/stop` | Stop waits up to 60 s so the world is saved |
| DELETE | `/servers/{id}` | Removes the container and its world volume |
| GET | `/servers/{id}/logs` | Console as Server-Sent Events (last 200 lines, then live) |
| POST | `/servers/{id}/command` | `{command}`; Java via RCON, Bedrock via stdin |

Each server gets the `itzg/minecraft-server` (Paper) or `itzg/minecraft-bedrock-server` image,
a memory and CPU limit from its plan, its world in a `mc-<id>` volume, and up to 3 automatic
restarts after a crash.
