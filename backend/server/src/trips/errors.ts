// GraphQL-shaped errors for the trips port. Codes match the service contract.

import { GraphQLError } from 'graphql';

export function tripError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}
