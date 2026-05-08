# Nexus Backend

The backend service for the Nexus application, built with [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and PostgreSQL.

## Features

- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT & Passport (with bcrypt for password hashing)
- **Real-time**: WebSockets using Socket.io
- **API Documentation**: Swagger/OpenAPI
- **Validation**: `class-validator` & `class-transformer`
- **Security**: Helmet, Rate Limiting (`@nestjs/throttler`), CORS
- **Containerization**: Docker & Docker Compose

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) & Docker Compose (for running the database locally)

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd nexus-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory based on the `.env.example` file.

```bash
cp .env.example .env
```

Ensure you update the database credentials and JWT secrets in the `.env` file.

### 4. Database Setup

You can start the PostgreSQL database using Docker Compose:

```bash
docker-compose up -d
```

Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate:dev
```

### 5. Running the Application

```bash
# development
npm run start

# watch mode
npm run start:dev

# production mode
npm run start:prod
```

The application will start on `http://localhost:3000` (or the port specified in your `.env`).

## API Documentation

Once the application is running, the Swagger UI is available at:

```
http://localhost:3000/api
```
*(If configured in `main.ts`)*

## Available Scripts

- `npm run build`: Compile the application.
- `npm run format`: Format code using Prettier.
- `npm run lint`: Lint code using ESLint.
- `npm run type-check`: Run TypeScript type checking.
- `npm run test`: Run unit tests.
- `npm run test:e2e`: Run end-to-end tests.
- `npm run test:cov`: Run tests and generate coverage report.

## Docker Deployment

To build and run the application entirely via Docker:

```bash
# Build the Docker image
docker build -t nexus-backend .

# Use docker-compose to bring up the database and application (if configured together)
docker-compose up --build
```
