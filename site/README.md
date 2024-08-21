# Heliotime Site

The Next.js server serving an interactive graph of the flux data and a Helioviewer preview.

## Getting Started

Ensure you have [Node.js](https://nodejs.org/) and [Yarn](https://classic.yarnpkg.com) installed and the server components and database are running:

```sh
# Run in repository root (../)
./du.sh dev deploy db api importer
```

First, build the Visx submodule:

```sh
yarn build:visx
```

Next, install all dependencies (including Visx):

```sh
yarn install
```

Finally, run the development server:

```bash
yarn dev
```

The site will be available at:

- <http://localhost:3000>

The graph might be empty because the data is still importing.
