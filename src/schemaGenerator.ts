import {
  GraphQLTypeDefinition,
  GraphQLFieldDefinition,
  isCustomType,
} from "./graphqlTypes";
import { defaultResolvers, ResolverContext } from "./defaultResolvers";

// Custom scalar for Date type that serializes to ISO string
const dateScalar = {
  serialize(value: Date): string {
    return value.toISOString();
  },
  parseValue(value: string): Date {
    return new Date(value);
  },
};

function generateInputType(
  prefix: string,
  fields: GraphQLFieldDefinition[]
): string {
  const inputFields = fields
    .filter((field) => field.name !== "id") // Exclude id field for inputs
    .map((field) => {
      // For input types, convert custom types to ID
      const inputField = isCustomType(field.type)
        ? { ...field, type: "ID" }
        : field;

      const typeString = generateTypeString(inputField, true);
      const description = field.description ? `  "${field.description}"\n` : "";
      return `${description}  ${field.name}: ${typeString}`;
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
  // Always include id field first
  const idField = `  "Unique identifier"\n  id: ID!`;

  // Only include creator field for non-User types
  const creatorField =
    type.name !== "User"
      ? `  "User who created this item"\n  creator: User!`
      : null;

  const fields = type.fields
    .filter((field) => field.name !== "id" && field.name !== "creator") // Remove any manually defined id or creator fields to avoid duplicates
    .map((field) => {
      const typeString = generateTypeString(field);
      const description = field.description ? `  "${field.description}"\n` : "";
      return `${description}  ${field.name}: ${typeString}`;
    })
    .join("\n");

  let allFields: string;
  if (creatorField) {
    allFields = fields
      ? `${idField}\n${creatorField}\n${fields}`
      : `${idField}\n${creatorField}`;
  } else {
    allFields = fields ? `${idField}\n${fields}` : idField;
  }

  const typeDescription = type.description ? `"${type.description}"\n` : "";

  return `${typeDescription}type ${type.name} {\n${allFields}\n}`;
}

export function generateSchema(types: GraphQLTypeDefinition[]) {
  console.log(
    "Starting schema generation with types:",
    types.map((t) => t.name)
  );

  // Create a map for quick type lookup
  const typeMap = new Map<string, GraphQLTypeDefinition>();
  types.forEach((type) => typeMap.set(type.name, type));

  // Generate type definitions
  let typeDefsArray = types
    .map((type) => {
      console.log(`Generating type definition for ${type.name}`);
      console.log(
        `Fields:`,
        type.fields.map((f) => `${f.name}: ${f.type}`)
      );
      return [
        generateObjectType(type),
        generateInputType(`Create${type.name}Input`, type.fields),
        generateInputType(`Update${type.name}Input`, type.fields),
      ];
    })
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
      const baseMutations = `  create${type.name}(input: Create${type.name}Input!): ${type.name}!
  update${type.name}(id: ID!, input: Update${type.name}Input!): ${type.name}`;

      // Generate array field convenience methods
      const arrayMutations = type.fields
        .filter((field) => field.isList)
        .map((field) => {
          const fieldName = field.name;
          // Use singular form for the mutation name and parameter
          const singularFieldName = fieldName.endsWith("s")
            ? fieldName.slice(0, -1)
            : fieldName;
          const parameterName = singularFieldName + "Id";

          return `  add${type.name}${
            singularFieldName.charAt(0).toUpperCase() +
            singularFieldName.slice(1)
          }(id: ID!, ${parameterName}: ID!): ${type.name}
  remove${type.name}${
            singularFieldName.charAt(0).toUpperCase() +
            singularFieldName.slice(1)
          }(id: ID!, ${parameterName}: ID!): ${type.name}`;
        })
        .join("\n");

      return baseMutations + (arrayMutations ? "\n" + arrayMutations : "");
    })
    .join("\n");

  // Combine all type definitions
  const typeDefs = `
scalar Date

${typeDefsArray.join("\n\n")}

type Query {
${queryFields}
}

type Mutation {
${mutationFields}
}
`;

  console.log("Final generated type definitions:", typeDefs);

  // Generate resolvers
  const resolvers = {
    Date: dateScalar,
    Query: {},
    Mutation: {},
  };

  console.log("Generated resolvers with scalar types:", Object.keys(resolvers));

  // Add resolvers for each type
  types.forEach((type) => {
    // Use plural form for collection names
    const collectionName = `${type.name.toLowerCase()}s`;

    // Query resolvers
    Object.assign(resolvers.Query, {
      [`get${type.name}`]: async (
        _: any,
        { id }: { id: string },
        context: ResolverContext
      ) => {
        return defaultResolvers.getDocument(collectionName, id, context, type);
      },
      [`getAll${type.name}s`]: async (
        _: any,
        __: any,
        context: ResolverContext
      ) => {
        return defaultResolvers.getDocuments(collectionName, context, type);
      },
    });

    // Mutation resolvers
    Object.assign(resolvers.Mutation, {
      [`create${type.name}`]: async (
        _: any,
        { input }: { input: Record<string, any> },
        context: ResolverContext
      ) => {
        return defaultResolvers.createDocument(
          collectionName,
          input,
          context,
          type
        );
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
          context,
          type
        );
      },
    });

    // Add array field convenience resolvers
    type.fields
      .filter((field) => field.isList)
      .forEach((field) => {
        const fieldName = field.name;
        // Use singular form for the resolver name and parameter
        const singularFieldName = fieldName.endsWith("s")
          ? fieldName.slice(0, -1)
          : fieldName;
        const capitalizedFieldName =
          singularFieldName.charAt(0).toUpperCase() +
          singularFieldName.slice(1);
        const parameterName = singularFieldName + "Id";

        Object.assign(resolvers.Mutation, {
          [`add${type.name}${capitalizedFieldName}`]: async (
            _: any,
            {
              id,
              [parameterName]: itemId,
            }: { id: string; [key: string]: string },
            context: ResolverContext
          ) => {
            return defaultResolvers.addToArray(
              collectionName,
              id,
              fieldName,
              itemId,
              context,
              type
            );
          },
          [`remove${type.name}${capitalizedFieldName}`]: async (
            _: any,
            {
              id,
              [parameterName]: itemId,
            }: { id: string; [key: string]: string },
            context: ResolverContext
          ) => {
            return defaultResolvers.removeFromArray(
              collectionName,
              id,
              fieldName,
              itemId,
              context,
              type
            );
          },
        });
      });
  });

  return {
    typeDefs,
    resolvers,
  };
}
