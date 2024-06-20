# Heliotime Server

## Usage

Installation on Linux:

```bash
# Install Micromamba
"${SHELL}" <(curl -L micro.mamba.pm/install.sh)
# Create environment
micromamba create --file conda-lock.yml --name heliotime-server
```

Activate environment:

```bash
micromamba activate heliotime-server
```

Update lock file:

```bash
conda-lock --micromamba
```

To use PyCharm you can install conda and use the same environment:

```bash
micromamba install conda-forge::conda
```
