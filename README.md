# CampusNotes AI — Academic Notes Sharing & AI Study Platform

CampusNotes AI is a production-quality knowledge repository and AI-driven study platform engineered for college students.

---

## 🏛️ Architecture: How The Layers Communicate

```text
React (Client SPA)
       │  HTTP JSON requests (with Bearer JWT in Authorization Header)
       ▼
Express API (Backend Controller & Middlewares)
       │  Typesafe Object-Relational Mapping queries
       ▼
Prisma ORM (Data Access Layer)
       │  Native PostgreSQL wire protocol queries
       ▼
PostgreSQL (Relational Database)
```

### What Each Layer Does:
1. **React Client (`frontend/`)**:
   - Built with Vite, React 18, React Router, and Tailwind CSS.
   - Manages user UI state, form submissions, and JWT persistence in localStorage and cookies.
   - Intercepts outgoing HTTP requests to inject the bearer token via Axios.
2. **Express API Gateway (`backend/`)**:
   - Node.js server handling REST routing, CORS, rate limiting (protecting against brute-force attacks), and Helmet security headers.
   - Enforces the `authenticate` and `authorize` middlewares to guard routes.
   - Hashes passwords with bcrypt (10 salt rounds) before storing.
3. **Prisma ORM (`backend/prisma/`)**:
   - Provides typesafe models, migrations, and declarative schema definitions.
   - Translates JavaScript/TypeScript method calls into optimized SQL queries.
4. **PostgreSQL Database**:
   - The ACID-compliant relational data store housing Users, Colleges, Branches, Semesters, and Subjects.

---

## 🚀 Quick Start Guide

### 1. Configure Backend Environment
Copy the `.env.example` in `backend/` to `.env`:
```bash
cd backend
cp .env.example .env
```
Provide your actual PostgreSQL connection string in `DATABASE_URL`.

### 2. Generate Prisma Client & Migrate Database
Once your PostgreSQL instance is accessible:
```bash
# Push schema to PostgreSQL database
npm run prisma:push

# Seed academic hierarchy (Colleges, Branches, Subjects, and Admin user)
npm run prisma:seed
```

### 3. Run Development Servers
From the root repository:
```bash
# Run both backend (port 5000) and frontend (port 5173) concurrently:
npm run dev
```
Or individually:
```bash
npm run dev:backend   # In one terminal
npm run dev:frontend  # In a second terminal
```
