import { GraphQLTypeDefinition, GraphQLFieldDefinition } from "./graphqlTypes";
import { defaultResolvers, ResolverContext } from "./defaultResolvers";

function generateInputType(
  prefix: string,
  fields: GraphQLFieldDefinition[]
): string {
  const inputFields = fields
    .filter((field) => field.name !== "id") // Exclude id field for inputs
    .map((field) => {
      const typeString = generateTypeString(field, true);
      return `  ${field.name}: ${typeString}`;
    })
    .join("\n");

  return `input ${prefix} {\n${inputFields}\n}`;
}

function generateTypeString(
  field: GraphQLFieldDefinition,
  isInput: boolean = false
): string {
  // For input types, we don't want to make fields required
  const isRequired = isInput ? false : field.isRequired;

  let typeStr = field.type;
  if (field.isList) {
    typeStr = `[${typeStr}${field.isListItemRequired ? "!" : ""}]`;
  }
  if (isRequired) {
    typeStr = `${typeStr}!`;
  }
  return typeStr;
}

function generateObjectType(type: GraphQLTypeDefinition): string {
  const fields = type.fields
    .map((field) => {
      const typeString = generateTypeString(field);
      return `  ${field.name}: ${typeString}`;
    })
    .join("\n");

  return `type ${type.name} {\n${fields}\n}`;
}

export function generateSchema(types: GraphQLTypeDefinition[]) {
  // Generate type definitions
  let typeDefsArray = types
    .map((type) => [
      generateObjectType(type),
      generateInputType(`Create${type.name}Input`, type.fields),
      generateInputType(`Update${type.name}Input`, type.fields),
    ])
    .flat();

  // Generate Query type
  const queryFields = types
    .map((type) => {
      return `  get${type.name}(id: ID!): ${type.name}
  getAll${type.name}s: [${type.name}!]!`;
    })
    .join("\n");

  // Generate Mutation type
  const mutationFields = types
    .map((type) => {
      return `  create${type.name}(input: Create${type.name}Input!): ${type.name}!
  update${type.name}(id: ID!, input: Update${type.name}Input!): ${type.name}`;
    })
    .join("\n");

  // Combine all type definitions
  const typeDefs = `
${typeDefsArray.join("\n\n")}

type Query {
${queryFields}
}

type Mutation {
${mutationFields}
}
`;

  // Generate resolvers
  const resolvers = {
    Query: {},
    Mutation: {},
  };

  // Add resolvers for each type
  types.forEach((type) => {
    const collectionName = type.name.toLowerCase();

    // Query resolvers
    Object.assign(resolvers.Query, {
      [`get${type.name}`]: async (
        _: any,
        { id }: { id: string },
        context: ResolverContext
      ) => {
        return defaultResolvers.getDocument(collectionName, id, context);
      },
      [`getAll${type.name}s`]: async (
        _: any,
        __: any,
        context: ResolverContext
      ) => {
        return defaultResolvers.getDocuments(collectionName, context);
      },
    });

    // Mutation resolvers
    Object.assign(resolvers.Mutation, {
      [`create${type.name}`]: async (
        _: any,
        { input }: { input: Record<string, any> },
        context: ResolverContext
      ) => {
        return defaultResolvers.createDocument(collectionName, input, context);
      },
      [`update${type.name}`]: async (
        _: any,
        { id, input }: { id: string; input: Record<string, any> },
        context: ResolverContext
      ) => {
        return defaultResolvers.updateDocument(
          collectionName,
          id,
          input,
          context
        );
      },
    });
  });

  return {
    typeDefs,
    resolvers,
  };
}
