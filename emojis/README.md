Icons from [Lucide](https://lucide.dev)
- Color: #cdd6f4
- Stroke width: 2px
- Size: 40px

## Build the Docker image

```sh
docker build -t sushii-modmail-emojis .
```

## Run the Docker image

```sh
docker run --rm -it \
    -v "$PWD":/workspace \
    -w /workspace \
    sushii-modmail-emojis
```
