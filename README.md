# `CSV.parse`, `CSV.stringify` — a capable, easy-to-use CSV parser

This is a JavaScript module that can parse and create CSV files.
The parser can be configured with different options to separate table cells (like `,` or tabs), different string delimiters (like `"` or `'`); it can read inputs as a string or as a file (with line ends of any OS).

## Why?

JavaScript currently lacks a built-in CSV library, so I decided to make one.

## But why‽

Okay, there are multiple CSV libraries out there, and there are “trivial” solutions, like splitting a string by line breaks, then splitting each string by commas.
But parsing CSV is a lot more complicated than that.
This is an attempt to implement a full CSV parser / stringifier that follows [RFC 4180][rfc], but can be configured to be aligned with the parsing behavior of e.g. LibreOffice Calc.
In the end, this was just a programming challenge for me.

## Importing

The CSV parser is an ECMAScript 6 module, so it can be imported like this:

```js
import CSV from "/path/to/CSV.mjs";

// Use CSV.parse and CSV.stringify here.
```

## Feature overview

> Read how the parser works in detail in [DETAILS.md][details].

<!-- -->

> Read about the API in the next section.

The functionality scope of this parser is:

* Turn CSV text files into a nested array
* Turn CSV text files into an array of rows with a header-to-value mapping
* Make the string delimiter configurable
* Make the cell separators configurable
* When a CSV file doesn’t follow RFC 4180, parse it like other parsers would (e.g. LibreOffice Calc)
* Accept files with line ends from different operating systems (e.g. CRLF (`\r\n`) on Windows, LF (`\n`) on Linux, etc.)
* Stringify nested arrays into a CSV file
* Stringify arrays of rows with a header-to-value mapping into a CSV file
* Make the file output configurable (string delimiter, cell separator, line ends)

Note that every cell is interpreted as text, not as a number, date or something else; there are no arrays of columns; and there are no other spreadsheet features like selection of parts of a table, Excel functions, etc.
These things are out of scope for this project; this is not a spreadsheet library.

### Parsing

The parser is mostly based on recognizing when a cell starts and when it ends.
It implements a finite automaton (essentially a state transition table) and reads character by character; it transitions from a specific state to the next based on what character it reads.

For example, a cell can be unquoted, e.g. `Hello`, or quoted, e.g. `"Planet ""Earth""."` (quotes within quoted strings are escaped like `""`).
In this case, the parser distinguishes between different rules to determine when an unquoted cell ends and when a quoted cell ends.

When it’s done, it outputs an object with the header row (the first row) and all remaining rows as simple arrays as well as objects mapping each header to its corresponding cell value.

A few parsing options exist to tell the parser how to treat the input string, how strict the RFC should be followed, and even whether the parser should exhibit specific bugs from other parsers.

### Stringification

The stringification accepts exactly the same output from the parser, although the mapped rows are optional; but it also accepts a simple nested array of values.
Then each value containing string delimiters or cell separators, is properly quoted and escaped.
Finally, everything is simply concatenated together with the right delimiters.
Rows with insufficiently many values are padded to the end.

## API

The CSV parser has two methods: `parse` and `stringify`.
The naming is the same as in the built-in JSON parser.

Note: in the following examples, `⟨SP⟩` means the literal space character U+0020.

### `CSV.parse`

```js
const {
  header,
  rows,
  mappedRows
} = CSV.parse(
    csvString,
    {
      quote,
      separators,
      forceLineFeedAfterCarriageReturn,
      linefeedBeforeEOF,
      ignoreSpacesAfterQuotedString,
      taintQuoteSeparatorLines
    } // defaults to {}
  );
```

#### `csvString`: string

This is the input string; the CSV file to be parsed.

#### `quote`: string; default: `"\""`

This is the sole single-character string delimiter used for quoted values.

#### `separators`: string | Array; default: `","`

These are the possible single-character strings to delimit cells.
As an Array, each single-character element is a separator; as a string, each character is a separator.

#### `forceLineFeedAfterCarriageReturn`: boolean; default: `true`

If `true`, line ends can only be `\n` or `\r\n`; a stray `\r` is interpreted as a separate line break.
If `false`, `\n\r` will also be an acceptable line break (LibreOffice Calc does this).

#### `linefeedBeforeEOF`: boolean; default: `false`

If `true`, the `csvString` is parsed as a text file and is expected to have a line break before EOF; if it doesn’t, a line break will be appended.

#### `ignoreSpacesAfterQuotedString`: boolean; default: `true`

If `true`, values like `⟨SP⟩"Apples"⟨SP⟩` are interpreted as `Apples`, as expected.
If `false`, values like these are parsed as `Apples⟨SP⟩` instead (LibreOffice Calc version 6.3.3.2.0 does this).

#### `taintQuoteSeparatorLines`: boolean; default: `false`

You can specify the string delimiter to be the same as the cell separator, e.g. `CSV.parse(someString, { quote: ",", separatos: ",;" })`.
It seems as though the CSV file parsing would be ambiguous in this case, but, for reference, LibreOffice Calc has specific parsing rules for this.
Read more about it in the [details][details].

In short: you can quote values like this: `,Foxes,`.
You can start your next cell with a space and a comma like `,Foxes, ,Wolves` (the comma before `Wolves` is a cell separator, the others are quotes).
And of course, you can use line breaks in your quoted strings and use multiple different cell separators:

```
,Foxes
Wolves, ,Tucans;Birds of Paradise
```

One possible bug in LibreOffice Calc version 6.3.3.2.0 is this: if you have a quoted value in a specific row, then afterwards have a quoted value right after a cell separator that coincides with the string delimiter, then you cannot use line breaks in this value; instead the quote will be terminated and a new row will start.

For example, consider this:

```
,Foxes & Wolves, ,Tucans,,Birds
of Paradise,
```

The bug means, that LibreOffice Calc parses this as `[ "Foxes & Wolves ", "Tucans", "Birds" ]` in the first row and `[ "of Paradise" ]` in the second row, even though it seems that `Birds\nof Paradise` is a quoted value.

I call rows that behave like this _tainted_, beginning after the first quoted value.

Note that replacing the `,` right after `Tucans` by `;` will work “as expected”.
Only a cell following a `,` (in this case) exhibits this misbehavior.

If this property is set to `true`, the parser matches this buggy behavior from LibreOffice Calc version 6.3.3.2.0.
If it’s `false`, parsing results in the “expected” output.

---

#### `header`: Array

An array of strings representing the first row.

#### `rows`: Array

An array representing the remaining rows as arrays of strings.

#### `mappedRows`: Array

An array representing the remaining rows as objects whose key–value pairs are a mapping of each header to its corresponding value.

---

#### Examples:

```js
const csvString = `Country,Capital City
Germany,Berlin
Italy,Rome
Russia,Moscow`;

const countries = CSV.parse(csvString);

// countries:
{
  header: [ "Country", "Capital City" ],
  rows: [
    [ "Germany", "Berlin" ],
    [ "Italy", "Rome" ],
    [ "Russia", "Moscow" ]
  ],
  mappedRows: [
    {
      Country: "Germany",
      "Capital City": "Berlin"
    },
    {
      Country: "Italy",
      "Capital City": "Rome"
    },
    {
      Country: "Russia",
      "Capital City": "Moscow"
    }
  ]
}
```

```js
const csvString = `Music Genre;Number of Songs
'Rock''n''Roll';4145
'Drum'n'Bass';513
'Reggae' ;372
`;

const music = CSV.parse(csvString, {
  quote: "'",
  separators: ";",
  ignoreSpacesAfterQuotedString: true,
  linefeedBeforeEOF: true
});

// music:
{
  header: [ "Music Genre", "Number of Songs" ],
  rows: [
    [ "Rock'n'Roll", "4145" ],
    [ "Drum'n'Bass", "513" ], // Note the quotes were incorrectly escaped in the input
    [ "Reggae", "372" ] // Note it’s not "Reggae⟨SP⟩"
    // Note no fourth empty row is included, because a linefeed at the end of the string is expected
  ],
  mappedRows: [
    {
      "Music Genre": "Rock'n'Roll",
      "Number of Songs": "4145"
    },
    {
      "Music Genre": "Drum'n'Bass",
      "Number of Songs": "513"
    },
    {
      "Music Genre": "Reggae",
      "Number of Songs": "372"
    }
  ]
}
```

```js
const csvString = `Column 1;Column 2
Value 1a,Value 2a
Value 1b\tValue 2b`;

const example = CSV.parse(csvString, {
  separators: ",;\t" // or [ ",", ";", "\t" ]
});

// example:
{
  header: [ "Column 1", "Column 2" ],
  rows: [
    [ "Value 1a", "Value 2a" ],
    [ "Value 1b", "Value 2b" ]
  ],
  mappedRows: [
    {
      "Column 1": "Value 1a",
      "Column 2": "Value 2a"
    },
    {
      "Column 1": "Value 1b",
      "Column 2": "Value 2b"
    }
  ]
}
```

### `CSV.stringify`

```js
const csvString = CSV.stringify(
    input,
    {
      quote,
      separator,
      lineEnd,
      trimEmpty,
      lineEndBeforeEOF
    } // defaults to {}
  );
```

#### `input`: Array | Object

If an Array, then it’s interpreted as an array of rows.
Each row is represented by an array of cells, and each cell is a value (e.g. a string).

If an Object, then it must be `{ header, rows }` or `{ header, mappedRows }`.

##### `header`: Array

The array of strings representing the header row.

##### `rows`: Array

The array of arrays representing all other rows (arrays of values, e.g. strings).

##### `mappedRows`: Array

An array of objects like in the parser output.

#### `quote`: string; default: `"\""`

The single-character string delimiter to be used in the output file.

#### `separator`: string; default: `","`

The single-character cell separator to be used in the output file.

#### `lineEnd`: string; default: `"\n"`

The string to end lines (rows) to be used in the output file.
Only `\n` (Linux), `\r\n` (Windows), and `\r` (Mac OS classic) are valid.
Invalid line break sequences will fall back to `\n`.

#### `trimEmpty`: boolean; default: `true`

If `true`, completely empty columns are trimmed from the right and completely empty rows are trimmed from the bottom.

#### `lineEndBeforeEOF`: boolean; default: `false`

If `true`, the `lineEnd` is appended to the string so it can be used as a text file.

---

#### `csvString`: string

This is the output of the stringifier: a valid CSV string given the inputs.

---

#### Examples:

Taking the parsing example from above:

```js
const countriesCSV = CSV.stringify(countries, {
    quote: "'",
    separator: ";",
    lineEndBeforeEOF: true
  });

// countriesCSV:
`Country;Capital City
Germany;Berlin
Italy;Rome
Russia;Moscow
`
```

```js
const exampleCSV1 = CSV.stringify([
    [ "Column 1", "Column 2", "", "" ],
    [ "Value 1a", "Value 2a" ],
    [ "Value 1b" ],
    [ "" ]
  ], {
    trimEmpty: false
  });

// exampleCSV1:
`Column 1,Column 2,,
Value 1a,Value 2a,,
Value 1b,,,
,,,`

const exampleCSV2 = CSV.stringify([
    [ "Column 1", "Column 2", "", "" ],
    [ "Value 1a", "Value 2a" ],
    [ "Value 1b" ],
    [ "" ]
  ], {
    trimEmpty: true
  });

// exampleCSV2:
`Column 1,Column 2
Value 1a,Value 2a
Value 1b,` // Note that the padded commas are gone, except where the columns aren’t completely empty
```


  [rfc]: https://tools.ietf.org/html/rfc4180
  [details]: DETAILS.md
