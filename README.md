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
- `npm run seed:demo -- --yes`: Add the demo school (see below). Needs `npm run build` first.

## Demo School

For sales demos and a realistic place to try changes, one command adds a complete demo school:

```bash
npm run build
npm run seed:demo -- --yes                      # prints a generated password
npm run seed:demo -- --yes --password "my-demo-pass"
```

It creates a school with the slug `demo-school` and every module switched on: two campuses
(Main and North), classes and sections, 24 students with guardians (some siblings share a
guardian), six staff (two with access roles, Accountant and Front Desk), 20 school days of
attendance, three months of fee vouchers and payments, a published mid-term exam for each class,
and two months of paid payroll with the current month still to pay. Every demo account signs in
with the one password the command prints: the admin with `admin@demo-school.test`, a student with
a registration number such as `DEMO-0001`, and a guardian with a phone such as `+923000000001`.

The command shows which database it will write to and does nothing without `--yes`. It only adds
a new school: if `demo-school` already exists it stops without changing anything, and it never
deletes. To start again, remove the school from the platform console first. The sample data is
the same on every run, so reports show the same figures.

## Docker Deployment

To build and run the application entirely via Docker:

```bash
# Build the Docker image
docker build -t nexus-backend .

# Use docker-compose to bring up the database and application (if configured together)
docker-compose up --build
```
