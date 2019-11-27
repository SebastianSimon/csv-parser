# Detailed explanation of the CSV parser

## Preliminaries

The functionality of the parser will be explained here in depth.
This is an ECMAScript 6 module; it’s written in JavaScript and uses modern features including the ones from the upcoming ECMAScript 2020 specification and current [Stage 3][tc39] proposals.
It works in the current Nightly builds of Firefox without polyfills or transpiling.

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

* [Destructuring][destructuring]

## Top-down explanation of the code

The value exported by default is the result of an arrow IIFE.
The return value of that function expression is an object containing two methods: `parse` and `stringify`.
Several other constant variables are scoped within the arrow IIFE.

### Parsing

The **`parse` method** accepts two arguments:

1. `csv`, and
2. `{quote = "\"", separators = [","], forceLineFeedAfterCarriageReturn = true, linefeedBeforeEOF = false, ignoreSpacesAfterQuotedString = true, taintQuoteSeparatorLines = false} = {}`.

So, if only one argument is provided, the empty object will be the default second argument, otherwise the real second argument is used.
In any case, these properties are destructured from the second argument:

* `quote` (defaulting to the string `"\""` if missing),
* `separators` (defaulting to `[ "," ]`),
* `forceLineFeedAfterCarriageReturn` (defaulting to `true`),
* `linefeedBeforeEOF` (defaulting to `false`),
* `ignoreSpacesAfterQuotedString` (defaulting to `true`),
* `taintQuoteSeparatorLines` (defaulting to `false`).

The defaults assume that the CSV file has quoted values like `"Value"`, is comma-separated, follows the RFC recommendation of using only `\n` or `\r\n` as linebreaks and is a string instead of a file.

#### Preprocessing the CSV file

First, `csv` is processed in this order, applying some of the boolean settings:

1. Every line break is replaced by `"\n"`.
   * The **`strictLinebreakGroups` RegExp** (options `\r\n` and `\r`, globally) is used if `forceLineFeedAfterCarriageReturn` is `true`;
   * otherwise the **`looseLinebreakGroups` RegExp** (options `\r\n`, `\n\r` and `\r`, globally) is used.
2. If `linefeedBeforeEOF` is `true` and `csv` actually ends with a linefeed, then the string isn’t modified; in any other case a linefeed is appended to make parsing consistent.
3. All null bytes are removed.

Note that null bytes are only removed after line breaks are handled.
This is how LibreOffice Calc does things.

#### Validating quotes and separators

Next, the quote must only be a single character, but multiple separators can be provided.
To make sure these restrictions hold, the **`toCharArray` function** is used: both variables are checked whether they are a string or an array, and then are converted to an array, each containing its allowed string delimiter or cell separators.
If the argument is a string, an array of characters is returned.
If the argument is an array, it is returned, but with everything that isn’t a single-character string removed.
Otherwise, the empty array is returned.

Both resulting arrays are filtered using the **`validQuotesAndSeparators` function**: quotes and separators cannot be empty, `"\n"`, or `"\r"`.
For the resulting `quote` array, only the first single-character string element is used (or the empty string, if `undefined` or empty).

It doesn’t matter if these special characters are empty; they will just never be matched.

#### Tokenization

At this point, the CSV text is preprocessed so it can be parsed more easily.
Now, the string is split into its characters using `Array.from(csv)`.
Note that `csv.split("")` isn’t used, since that would split the string into UTF-16 byte pairs instead of characters (e.g. `🕴` would be split into the length-2 string `\uD83D\uDD74`).
With `Array.from(csv)` (or, equivalently, `[ ...csv ]`), a levitating man in a business suit can be used to quote values in this CSV parser.

Now, the fun part begins: going through the CSV file character by character while figuring out where a table cell starts and where it ends by transitioning states in a finite automaton.
Since we need to iterate while maintaining a few states, `reduce` is used here.
All the resulting data and states are aggregated in the “aggregator” — the second `reduce` argument; it consists of:

* `array`: the nested array containing rows of table cells representing the result of the parsing step,
* `parserState`: the current state of the parser given the current character,
* `quote`,
* `separators`,
* `linefeedBeforeEOF`,
* `taintQuoteSeparatorLines`: the boolean enabling the buggy behavior from LibreOffice Calc version 6.3.3.2.0 — only actually enabled if the set of `separators` includes `quote`,
* `lineTaint`: the current state of the line (i.e. table row): essentially _tainted_ or not.

`quote`, `separators`, `linefeedBeforeEOF` are needed as-is in the parser.

“Parsing” here means to **_tokenize_ the CSV file into its cells**.
That’s why the `reduce` method calls the **`tokenizeCells` function** which accepts all four reducer parameters `aggregator`, `character`, `index`, `string`.
The last two are needed to check when the end of the file is reached.
The tokenizer is called in each iteration (i.e. each for each `character`) and performs these steps:

1. Classify the current character,
2. Given the character class, transition from the current parser state to the next one,
3. Manipulate the parser state for special cases (e.g. tainted rows),
4. Decide how the character affects the `array` in the `aggregator` based on the new state,
5. Return the `aggregator` for use in the next iteration.

##### Character classes

Two functions are used to classify characters in two different ways:

The **`classifyCharacter` function** receives a character as an input, along with the currently used quote character and the set of cell separators.
It returns an array of all the sets the character is in.

Specifically, the character can be _in_:

* `linefeed` if it’s `"\n"`,
* `quote` if it’s exactly the one `quote` being used,
* `separator` if it’s one of the `separators`,
* `space` if it’s the space character U+0020,
* `other` if it’s anything else.

The result is an array of these character class names as strings.
For example:

* If your `quote` is `"\""` and `separators` is `[ "," ]` (the default), then `","` will be classified as `[ "separator" ]`, `"*"` as `[ "other" ]`.
* If your `quote` is `" "` and `separators` is `[ " ", "," ]`, then `","` will still be classified as `[ "separator" ]`, but `" "` as `[ "quote", "separator", "space" ]`.

The **`reduceClass` function** converts the array to a single, simplified string.
In order to understand which reduced classes are specifically needed, we first need to take a look at the state transitions.

##### States

When going through a CSV file character by character, there are a couple of states that need to be tracked.
For example:

* Is a cell empty?
* Is a cell quoted or unquoted?
* Is a quoted value open or closed?

When reading from left to right, it’s not known whether a value is quoted or unquoted if there are a bunch of spaces at the start.
Of course, a value can be neither open nor closed if it’s not quoted to begin with.
But _if_ it’s quoted, it turns out that a state “in between” open and closed is needed for some special cases: in this case it’s called “waiting” (as in waiting to see if the quoted value actually ends at a specific character).

There also needs to be at least one final, accepting state — in this case there are two.
A cell can simply be “finished” when it’s completely read; then a new cell starts after the finished cell has been placed into the table.
But a cell could also be _discarded_ when it’s an _empty_ cell after a trailing comma at the end of a row; for example, this CSV file only has two columns, not three:

```csv
Greek,Hebrew,
Alpha,Alef,
Beta,Bet,
Gamma,Gimel,
```

After eliminating impossible state combinations (like “unquoted and open”), these are the reasonable states:

* `empty`: when a cell hasn’t started yet; e.g. at the beginning of a file, or each time a new cell begins.
* `unsettled`: when the cell has content, but so far only spaces, and it’s not known yet whether the value will be quoted or not.
* `unquoted`: when the cell has unquoted content.
* `open`: when the cell has quoted content and the current character is within the quote (or opens it).
* `waiting`: when the cell has quoted content and the current character might be outside the quote (or closing it).
* `closed`: similar to `waiting`, but with a larger bias towards keeping the quote closed and finishing the cell.
* `finished`: when the cell is finished and is to be included in the table.
* `discarded`: when the cell is finished but is not to be included in the table.

When reading quotes inside a quoted value, the states generally switch from `open` to `waiting` and vice-versa.
The `waiting` state is useful for escape sequences of quotes (e.g. `""` inside a quoted value creates a single `"`); in the `closed` state, these aren’t possible.
A `closed` cell can still be reopened, but in fewer circumstances than in the `waiting` state.
The exact differences will be explained in the state transition table below.

Technically, you could differentiate between two variants of `finished` — a finished _row_ or a finished _cell_ — but these are distinguished specially using `if` statements.

##### Reduced character classes

When considering what kinds of characters might be read, these are all the possibilities:

* `linefeed`
* `other`
* `quote`
* `separator`
* `space`
* `quote` and `separator`
* `quote` and `space`
* `separator` and `space`
* `quote`, `separator` and `space`

But, fortunately, extensive testing shows that some possibilities have exactly equivalent behavior:

* _`quote` and `space`_ behaves exactly like just _`quote`_,
* _`separator` and `space`_ behaves exactly like just _`separator`_.

There’s also a close similarity between _`quote` and `separator`_ and _`quote`, `separator` and `space`_.
Only one state transition cannot be tested because it’s actually unreachable: if `quote` and `separator` are both a `space`, then the `closed` state can never be reached.
All other transitions from these two possible sets of character classes are identical, so we can say:

* _`quote`, `separator` and `space`_ behaves exactly like _`quote` and `separator`_.

As a result, the **`reduceClass` function** only considers these simplified character classes for transitioning states:

* `linefeed`,
* `other`,
* `quote`,
* `separator`,
* `space`,
* `quoteSeparator`: the combination of `quote` and `separator`, i.e. if a character is both the `quote` and one of the `separators`.

##### State transition table

This is the full table of state transitions.
The current state is in the left column, the reduced character classes are in the other columns.
The next state is in the same row as the current state and in the same column as the reduced character class of the current character.
All this was basically reverse engineered using LibreOffice Calc.

State       | | `linefeed`  | `other`    | `quote`    | `separator` | `space`     | `quoteSeparator`
------------|-|-------------|------------|------------|-------------|-------------|-----------------
`empty`     | | `discarded` | `unquoted` | `open`     | `finished`  | `unsettled` | `open`
`unsettled` | | `finished`  | `unquoted` | `open`     | `finished`  | `unsettled` | `open`
`unquoted`  | | `finished`  | `unquoted` | `unquoted` | `finished`  | `unquoted`  | `finished`
`open`      | | `open`      | `open`     | `waiting`  | `open`      | `open`      | `waiting`
`waiting`   | | `finished`  | `open`     | `open`     | `finished`  | `closed`    | `open`
`closed`    | | `finished`  | `open`     | `closed`   | `finished`  | `closed`    | `finished`

For example, if the current state is `unsettled` and a `quote` is read, then the state transitions to `open`.

Some things to point out:

* An unquoted value can either be terminated by any character that terminates cells or rows, or it remains unquoted.
* An open quoted value remains open, but a quote character puts it into the waiting state, where the parser waits for one of several possibilities:
   * A linefeed or cell separator will immediately finish the cell
   * Another quote results in an escape sequence and leaves the quote open
   * A space closes the quote: no escape sequence is possible at this point
   * A random “other” character means that the CSV is malformed, but it’s interpreted as part of the quoted value — the unescaped quote characters are included in this value verbatim
* Spaces are just special because they are usually ignored before and after quoted values, so they almost never change the state, except where they take away the opportunity to create an escape sequence for quotes.
* Once a quoted value is closed, a quote character will leave the cell closed since a quoted value needs to end with a quote; it can still be reopened (i.e. literally transition to the `open` state) with any “other” character. Escape sequences are possible again after this point.
* At the start of a cell, a `quoteSeparator` opens quoted values rather than finishes cells.
* A `quoteSeparator` behaves like a quote when an escape sequence is still possible, but like a separator when it isn’t.
* If the `quote` or one of the `separators` is a `space`, then the `closed` state can never be reached since the only entry point for this state is from `waiting` via `space`. But `space`, as such, doesn’t exist in this case: the character class for a space is always going to be reduced to either `quote`, `separator` or `quoteSeparator`.

This is how it’s implemented in the code: the **`transition` function** takes the current state (`parserState`) and the reduced character class (`reducedClass`), then returns `states[parserState][reducedClass]`.
`states` is an object whose keys are all possible states; their values are objects whose keys are all possible reduced character classes; and _their_ values are the corresponding next states.

Since `empty` and `unsettled` are very similar, `empty` doesn’t appear in the `states` object; instead it is specially handled with a simple `if` statement.

Taking the example from above, `states["unsettled"]["quote"]` is the same as this:

```js
({
  linefeed: "finished",
  other: "unquoted",
  quote: "open",
  quoteSeparator: "open",
  separator: "finished",
  space: "unsettled"
})["quote"]
```

And this expression evaluates to `"open"`.

##### Affecting the table based on the state

Now that the next state is determined, the table can be updated based on the character that was read.
Basically, characters that are part of the cell contents are “consumed” (i.e. placed into the current cell).
The separators and linefeeds control how cells and rows are created or deleted.

Specifically, these steps happen:

1. If the cell needs to be discarded, the **`discardCell` function** is called and the last cell in the table is removed; if this happens, the rest of the steps continue as if the state was `finished`
2. Is the last character of the CSV file being read?
   1. If _no_, is the cell finished?
      1. If _yes_, then the **`endCell` function** is called to end the cell and create the next one; whether the next cell is in the next column or in the next row depends on the character.
      2. If _no_, the current character is simply consumed using the **`consume` function**.
   2. If _yes_, quoted values that weren’t properly closed before EOF are handled: they are closed, and the linefeed before EOF may be included depending on parser settings and inputs.

##### Tainting rows

_Before_ the normal updates to the table described above, the parser state and the `lineTaint` may be manipulated.

_(WIP)_

##### Parsing examples

_(WIP)_

#### Processing quoted values

After tokenization, the `array` property is taken from the parsing process.
As a reminder: `array` is a nested array containing rows of table cells.
It’s an array of arrays of strings.

Each string is then processed to remove quotes and spaces around quoted values and handle escape sequences.

_(WIP)_

The result is an array that still has the same structure as the array after tokenization.
This result is then destructured into one `header` row (the first row) and all the other `rows`.

#### Building the parser output

At this point, the `header` row and the other `rows` are finished.
The `mappedRows` still need to be created.

_(WIP)_

_([`RegExp.escape`][regexp-escape] is polyfilled.)_

### Stringification

_(WIP)_

## Testing

_How was the parser / stringifier actually tested?_

Several special cases (e.g. empty file, null bytes, space characters other than U+0200, conflicting quotes and cell separators, etc.) were tested using hand-crafted test files.
I simply opened these in LibreOffice Calc and in a few other parsers to see how they were interpreted.

But the really powerful testing technique was _fuzzing_.
Fuzzing revealed the “tainted line” bug in LibreOffice Calc and a few other weird discrepancies.

I wrote a fuzzing test generator to generate and download test files and test outputs.
This is what I did with the help of the generator:

1. Generate a string that contains a random sequence of special characters (linefeeds, carriage returns, all cell separators, the quote, spaces, null bytes, etc.).
2. Feed this test string into the parser (with all the relevant options).
3. Stringify the parser output to a “nice” CSV output using a consistent quote and cell separator.
4. Create an “annotated” output that makes unprintable characters readable (e.g. prepending each linefeed with `⟨LF⟩`, each space with `⟨SP⟩`, etc.)
5. Download the “raw” and the “nice” file.
6. Open the “raw” file in LibreOffice using exactly the same settings and all columns formatted as text and then save it into another file (the “libre” file) using the same output options as this stringifier.
7. Compare the “nice” file to the “libre” file.

At some point, I noticed that null bytes and the diversity of spaces didn’t cause additional difficulties, so I simplified the tests by removing these characters.
Also, at some point, I felt comfortable enough to use `diff` to compare files, which is automatic, but also byte-exact.
I started with 100-character strings, then felt comfortable enough to test 1000-character strings.

The different parser options were generated using a few simple cases:

* `quote` was set to `"\""`, `","`, or `" "` in the tests.
* `separators` was set to `[ "," ]`, `[ "*" ]`, `[ " " ]`, `[ ",", "*" ]`, `[ ",", " " ]`, `[ "*", " " ]`, or `[ ",", "*", " " ]` in the tests.

All combinations of the two were tested a couple of times.


  [tc39]: https://github.com/tc39/proposals
  [destructuring]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment
  [regexp-escape]: https://esdiscuss.org/topic/regexp-escape
