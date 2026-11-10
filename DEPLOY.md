# GitHub → Cloudflare Pages

Repository: https://github.com/2603217657-gif/voicejournal

Create a new Cloudflare Pages project using Connect to Git, then select this repository.

- Production branch: main (or the actual default branch)
- Framework preset: None
- Build command: npm run build
- Build output directory: dist
- Root directory: leave empty

The build copies only browser assets into dist and disables backend endpoints for the static demo. Chat uses local rules. Node server.js and Python speech recognition do not run on Pages; real AI requires a separate backend or a Workers/Functions implementation.

Do not upload .env, .venv, models, node_modules, __pycache__, dist, or generated ZIP files. The .env.example template is safe to include.

The source files and directories must be at the repository root, not inside an extra enclosing folder. GitHub's web uploader does not unpack ZIP files: extract the source ZIP locally and upload its contents.

An existing Direct Upload Pages project cannot be converted to Git integration; create a new Pages project and retain the old site until the new deployment works.
