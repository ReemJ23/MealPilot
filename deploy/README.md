# MealPilot production deployment

This optional configuration runs MealPilot on a Linux machine with Docker Compose, MySQL, and automatic HTTPS from Caddy.

## Set up

1. Point a domain to the machine's public IP and allow inbound TCP ports 80 and 443.
2. Install Docker Engine with the Compose plugin.
3. Copy the repository onto the machine and open the `deploy` directory.
4. Copy `.env.example` to `.env`. Set `APP_DOMAIN` to your real domain. Replace both passwords with different strong secrets.
5. Run `docker compose up --build -d`.
6. Open `https://YOUR_DOMAIN/` and register an account. Use `docker compose logs -f app` if the application does not start.

The app initializes the database tables when it starts. MySQL data is stored in `mysql_data`, a named Docker volume that survives container replacement. Never run `docker compose down -v` on a deployment that contains user data.

## Publish and update

A merge to `main` triggers the release workflow. Its image is published to GitHub Container Registry as `ghcr.io/reemj23/mealpilot:latest`, with a commit-specific tag, after checks pass. Version tags beginning with `v` create downloadable GitHub Releases. GitHub Container Registry packages may need to be made public in the package settings before unauthenticated machines can pull them.

To update an existing deployment after the package is published, run these commands from `deploy`.

```sh
docker compose pull app
docker compose up -d --no-build
```

For the initial deployment without a published image, build locally using `docker compose up --build -d`.

The publishing workflow does not automatically modify a remote machine. A live deployment still requires hosting and an operator to run these deployment commands.

## Backups and secrets

Back up the MySQL database regularly, using `mysqldump` with a dedicated backup destination. Test restoring those backups. Keep the deployment `.env` file outside Git and restrict access. The `.gitignore` excludes `.env` files.

App and database containers communicate on the private Compose network. Only Caddy exposes ports to the public internet. Keep Docker and the container images updated.
