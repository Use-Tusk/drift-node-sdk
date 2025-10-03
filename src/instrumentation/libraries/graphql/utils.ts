interface GraphQLTypeNode {
  kind: string;
  type?: GraphQLTypeNode;
  name?: { value: string };
}

interface GraphQLVariableDefinition {
  variable?: { name?: { value: string } };
  type?: GraphQLTypeNode;
}

interface GraphQLSelectionSet {
  selections: GraphQLSelection[];
}

interface GraphQLSelection {
  kind: string;
  name?: { value: string };
  alias?: { value: string };
  selectionSet?: GraphQLSelectionSet;
  arguments?: GraphQLArgument[];
  directives?: GraphQLDirective[];
}

interface GraphQLArgument {
  kind: string;
  value?: any;
}

interface GraphQLDirective {
  arguments: GraphQLArgument[];
}

interface GraphQLOperationDefinition {
  kind: string;
  operation: string;
  name?: { value: string };
  variableDefinitions?: GraphQLVariableDefinition[];
  selectionSet: GraphQLSelectionSet;
}

interface GraphQLExecutionArgs {
  document: { definitions: any[] };
  variableValues?: any;
  operationName?: string;
}

export const getOperationDefinition = (
  payload: GraphQLExecutionArgs,
): GraphQLOperationDefinition | undefined =>
  payload.document.definitions.find(
    (definition: any) => definition?.kind === "OperationDefinition",
  ) as GraphQLOperationDefinition | undefined;
