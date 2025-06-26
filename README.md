# basebase

A NodeJS GraphQL server for everyone.

## Features

- Express.js with GraphQL Yoga
- MongoDB Atlas integration
- TypeScript support
- User management with CRUD operations

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=4000
   MONGODB_URI=your_mongodb_connection_string
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## GraphQL API

The server will be running at `http://localhost:4000/graphql` with GraphiQL interface enabled.

### Available Operations

- Query:
  - `users`: Get all users
  - `user(id: ID!)`: Get user by ID
- Mutation:
  - `createUser(input: CreateUserInput!)`: Create a new user
  - `updateUser(id: ID!, input: UpdateUserInput!)`: Update an existing user
  - `deleteUser(id: ID!)`: Delete a user
