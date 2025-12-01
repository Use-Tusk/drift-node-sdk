/**
 * Reconstruct a parameterized query string from template strings array and values.
 * Converts values to $1, $2, etc. placeholders.
 */
export function reconstructQueryString(strings: TemplateStringsArray, values: any[]): string {
  let queryString = "";
  for (let i = 0; i < strings.length; i++) {
    queryString += strings[i];
    if (i < values.length) {
      queryString += `$${i + 1}`;
    }
  }
  return queryString;
}
