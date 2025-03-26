FROM oven/bun:1.2.6

WORKDIR /app

# Copy package.json and lockfile first for better caching
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Set the command to run the bot
CMD ["bun", "start"]
