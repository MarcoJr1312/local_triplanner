// Stable user errors. Both adapters throw GraphQLError with the same codes so
// resolvers do not know whether the users service or the local table answered.

import { GraphQLError } from 'graphql';

export type UsersErrorCode =
  | 'USER_NOT_FOUND'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'PROTECTED_USER'
  | 'NOTIFICATION_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_ARGUMENT'
  | 'USERS_UNAVAILABLE';

export function usersError(code: UsersErrorCode | string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}
