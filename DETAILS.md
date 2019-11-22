# Detailed explanation of the CSV parser

## Preliminaries

The functionality of the parser will be explained here in depth.
This is an ECMAScript 6 module; it’s written in JavaScript and uses modern features up to the upcoming ECMAScript 2020 specification (current [Stage 3][tc39] proposals).
It works in the current Nightly builds of Firefox without polyfills.

There are a few coding patterns I use throughout the code:

* Arrow IIFEs to return a function — or an object containing a function — with other variables encapsulated in the same scope:

    ```js
    const result = (() => {
        const encapsulated = value;
        
        return (arg) => {
          doSomething(encapsulated, arg);
        };
      })();
    ```

* Method extraction for when I use a function that needs to accept a `this` context:

    ```js
    const {
      result
    } = {
        result(arg){
          return something(this, arg);
        }
      };
    ```

## Top-down explanation of the code

The value exported by default is the result of an arrow IIFE.
The return value of that function expression is an object containing two methods: `parse` and `stringify`.
Several other constant variables are scoped within the arrow IIFE.

The **`parse` method** accepts two arguments:

1. `csv`, and
2. `{quote = "\"", separators = [ "," ], forceLineFeedAfterCarriageReturn = true, linefeedBeforeEOF = false, ignoreSpacesAfterQuotedString = true, taintQuoteSeparatorLines = false} = {}`

So, if only one argument is provided, the empty object will be the default second argument, otherwise the real second argument is used.
In any case, these properties are destructured from the second argument:

* `quote` (defaulting to the string `"\""` if missing),
* `separators` (defaulting to `[ "," ]`),
* `forceLineFeedAfterCarriageReturn` (defaulting to `true`),
* `linefeedBeforeEOF` (defaulting to `false`),
* `ignoreSpacesAfterQuotedString` (defaulting to `true`),
* `taintQuoteSeparatorLines` (defaulting to `false`).

First, `csv` is processed in this order, applying some of the boolean settings:

1. Every line break is replaced by `"\n"`.
   * The **`strictLinebreakGroups` RegExp** (options `\r\n` and `\r`, globally) is used if `forceLineFeedAfterCarriageReturn` is `true`;
   * otherwise the **`looseLinebreakGroups` RegExp** (options `\r\n`, `\n\r` and `\r`, globally) is used.
2. If `linefeedBeforeEOF` is `true` and `csv` actually ends with a linefeed, then the string isn’t modified; in any other case a linefeed is appended to make parsing consistent.
3. All null bytes are removed.

Note that null bytes are only removed after line breaks are handled.
This is how LibreOffice Calc does things.

Next, the quote must only be a single character, but multiple separators can be provided.
To make sure these restrictions hold, the **`toCharArray` function** is used: both variables are checked whether they are a string or an array, and then are converted to an array, each containing its allowed string delimiter or cell separators.
If the argument is a string, an array of characters is returned.
If the argument is an array, it is returned, but with everything that isn’t a single-character string removed.
Otherwise, the empty array is returned.

Both resulting arrays are filtered using the **`validQuotesAndSeparators` function**: quotes and separators cannot be empty, `"\n"` or `"\r"`.
For the resulting `quote` array, only the first single-character string element is used (or the empty string, if `undefined` or empty).

_(WIP)_


  [tc39]: https://github.com/tc39/proposals
