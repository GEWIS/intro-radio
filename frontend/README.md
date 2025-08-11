# Intro Radio Frontend

This is the web frontend for Intro Radio, the GEWIS live stream during the introduction week.
It plays the Icecast stream and, for admins, provides the backoffice chat to talk with listeners.

## Install

```bash
yarn install
# or: npm install / pnpm install / bun install
```

## Usage

### Development

```bash
yarn dev
```

Opens the app at [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
yarn build
```

Outputs to `dist/` for deployment.

### Preview Build

```bash
yarn preview
```