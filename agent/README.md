# Node agent

Runs on each game host and manages one Docker container per Minecraft server for the web panel.
It talks to Docker over `/var/run/docker.sock` with no extra dependencies.

```bash
AGENT_TOKEN=some-long-secret go run .     # listens on :8081
go test ./...
```

| Env | Default | |
| --- | --- | --- |
| `AGENT_TOKEN` | (required) | Shared secret; the panel sends it as `Authorization: Bearer …` |
| `AGENT_ADDR` | `:8081` | Listen address. Keep it private (firewall or VPN), never public |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |

## API

| Method | Path | |
| --- | --- | --- |
| POST | `/servers` | Create and start a server: `{id, name, edition: JAVA\|BEDROCK, memoryMb, cpus, port, maxPlayers, version}` |
| GET | `/servers/{id}` | Container state, exit code, restart count, health |
| POST | `/servers/{id}/start`, `/stop` | Stop waits up to 60 s so the world is saved |
| DELETE | `/servers/{id}` | Removes the container and its world volume |
| GET | `/servers/{id}/logs` | Console as Server-Sent Events (last 200 lines, then live) |
| POST | `/servers/{id}/command` | `{command}`; Java via RCON, Bedrock via stdin |

Each server gets the `itzg/minecraft-server` (Paper) or `itzg/minecraft-bedrock-server` image,
a memory and CPU limit from its plan, its world in a `mc-<id>` volume, and up to 3 automatic
restarts after a crash.
