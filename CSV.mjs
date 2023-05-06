/* eslint no-unused-vars: [ "error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" } ] */
/* eslint no-trailing-spaces: [ "error", { "skipBlankLines": true } ] */

export default (() => {
    const toCharArray = (() => {
        const maxSingleChar = (element) => typeof element === "string" && element.length <= 1;
        
        return (object) => {
          if(typeof object === "string"){
            return Array.from(object);
          }
          
          if(Array.isArray(object)){
            return object.filter(maxSingleChar);
          }
          
          return [];
        };
      })(),
      validQuotesAndSeparators = (character) => character !== "" && character !== "\n" && character !== "\r",
      space = " ",
      strictLinebreakGroups = /\r\n|\r/g,
      looseLinebreakGroups = /\r\n|\n\r|\r/g,
      reduceClass = (characterClasses) => {
        if(characterClasses.length === 1){
          return characterClasses[0];
        }
        
        if(characterClasses.includes("space")){
          if(characterClasses.includes("quote") && !characterClasses.includes("separator")){
            return "quote";
          }
          
          if(!characterClasses.includes("quote") && characterClasses.includes("separator")){
            return "separator";
          }
        }
        
        if(characterClasses.includes("quote") && characterClasses.includes("separator")){
          return "quoteSeparator";
        }
      },
      transition = (() => {
        const states = {
            closed: {
              linefeed: "finished",
              other: "open",
              quote: "closed",
              quoteSeparator: "finished",
              separator: "finished",
              space: "closed"
            },
            open: {
              linefeed: "open",
              other: "open",
              quote: "waiting",
              quoteSeparator: "waiting",
              separator: "open",
              space: "open"
            },
            unquoted: {
              linefeed: "finished",
              other: "unquoted",
              quote: "unquoted",
              quoteSeparator: "finished",
              separator: "finished",
              space: "unquoted"
            },
            unsettled: {
              linefeed: "finished",
              other: "unquoted",
              quote: "open",
              quoteSeparator: "open",
              separator: "finished",
              space: "unsettled"
            },
            waiting: {
              linefeed: "finished",
              other: "open",
              quote: "open",
              quoteSeparator: "open",
              separator: "finished",
              space: "closed"
            }
          };
        
        return (parserState, reducedClass) => {
          if(parserState === "empty"){
            if(reducedClass === "linefeed"){
              return "discarded";
            }
            
            parserState = "unsettled";
          }
          
          return states[parserState][reducedClass];
        };
      })(),
      {
        parseSubArrays
      } = (() => {
        if(!RegExp.hasOwnProperty("escape")){ // From https://github.com/benjamingr/RegExp.escape/blob/master/polyfill.js
          const replacedChars = /[\\^$*+?.()|[\]{}]/g;
          
          Object.defineProperty(RegExp, "escape", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: Object.freeze({
              escape(string){
                return String(string).replace(replacedChars, "\\$&");
              }
            }).escape
          });
        }
        
        const {
            parseString
          } = {
            parseString(string){
              const {
                quote,
                ignoreSpacesAfterQuotedString
              } = this,
                surroundedQuotes = new RegExp(`^ *${RegExp.escape(quote)}([\\s\\S]*)${RegExp.escape(quote)}( *)$`),
                spaceQuotes = /^ ([\s\S]*) $/,
                escapedQuotes = new RegExp(`(${RegExp.escape(quote)})\\1`, "g");
              
              if(quote !== space && surroundedQuotes.test(string)){
                return string
                  .replace(surroundedQuotes, "$1" + (ignoreSpacesAfterQuotedString
                    ? ""
                    : "$2"))
                  .replace(escapedQuotes, "$1");
              }
              
              if(quote === space && spaceQuotes.test(string)){
                return string
                  .replace(spaceQuotes, "$1")
                  .replace(escapedQuotes, "$1");
              }
              
              return string;
            }
          };
        
        return {
          parseSubArrays(subArray){
            return subArray.map(parseString, this);
          }
        };
      })(),
      classifyCharacter = (character, quote, separators) => {
        const characterClasses = [];
        
        if(character === "\n"){
          characterClasses.push("linefeed");
        }
        else{
          if(character === quote){
            characterClasses.push("quote");
          }
          
          if(separators.includes(character)){
            characterClasses.push("separator");
          }
          
          if(character === space){
            characterClasses.push("space");
          }
        }
        
        if(characterClasses.length === 0){
          characterClasses.push("other");
        }
        
        return characterClasses;
      },
      consume = (aggregator, character) => {
        const lastLine = aggregator.array[aggregator.array.length - 1];
        
        lastLine[lastLine.length - 1] += character;
      },
      discardCell = (aggregator) => {
        if(aggregator.array[aggregator.array.length - 1].length > 1){
          aggregator.array[aggregator.array.length - 1].pop();
        }
        
        aggregator.parserState = "finished";
        aggregator.lineTaint = "none";
      },
      endCell = (aggregator, characterClasses) => {
        if(characterClasses.includes("separator")){
          aggregator.array[aggregator.array.length - 1].push("");
        }
        else if(characterClasses.includes("linefeed")){
          aggregator.array.push([
            ""
          ]);
          aggregator.lineTaint = "none";
        }
        
        aggregator.parserState = "empty";
      },
      lineTaintActivation = (aggregator, reducedClass) => {
        if(reducedClass === "quoteSeparator"){
          aggregator.lineTaint = "active";
        }
        else if(reducedClass === "separator"){
          aggregator.lineTaint = "inactive";
        }
      },
      tokenizeCells = (aggregator, character, index, string) => {
        const characterClasses = classifyCharacter(character, aggregator.quote, aggregator.separators),
          reducedClass = reduceClass(characterClasses);
        let nextState = transition(aggregator.parserState, reducedClass);
        
        if(aggregator.taintQuoteSeparatorLines){
          if(nextState === "finished" && reducedClass !== "linefeed" && (aggregator.parserState === "closed" || aggregator.parserState === "waiting")){
            lineTaintActivation(aggregator, reducedClass);
          }
          else if(nextState === "finished" || nextState === "discarded"){
            if(reducedClass === "linefeed"){
              aggregator.lineTaint = "none";
            }
            else if(aggregator.lineTaint !== "none"){
              lineTaintActivation(aggregator, reducedClass);
            }
          }
          
          if(reducedClass === "linefeed" && nextState === "open" && aggregator.lineTaint === "active"){
            consume(aggregator, aggregator.quote);
            nextState = "finished";
            aggregator.lineTaint = "none";
          }
        }
        
        aggregator.parserState = nextState;
        
        if(aggregator.parserState === "discarded"){
          discardCell(aggregator);
        }
        
        if(index !== string.length - 1){
          if(aggregator.parserState === "finished"){
            endCell(aggregator, characterClasses);
          }
          else{
            consume(aggregator, character);
          }
        }
        else if(aggregator.parserState === "open"){
          if(!aggregator.ignoreLinefeedBeforeEOF){
            consume(aggregator, character);
          }
          
          consume(aggregator, aggregator.quote);
        }
        
        return aggregator;
      },
      getLength = ({length}) => length,
      {
        toHashMap,
        mapHeaderKeys,
        toRows,
        quoteString,
        toCSVLine
      } = {
          toHashMap(row){
            return row.reduce((hashMap, cell, index) => {
              hashMap[this[index]] = cell;
              
              return hashMap;
            }, {});
          },
          mapHeaderKeys(key){
            return (this.hasOwnProperty(key)
              ? this[key]
              : "");
          },
          toRows(map){
            return this.map(mapHeaderKeys, map);
          },
          quoteString(cell){
            cell = String(cell);
            
            const {
              quote,
              separator
            } = this,
              quotedContent = cell.replaceAll(quote, `${quote}${quote}`);
            
            if(cell.includes("\n") || cell.includes(quote) || cell.includes(separator)){
              return `${quote}${quotedContent}${quote}`;
            }
            
            return cell;
          },
          toCSVLine(line){
            const {
              separator,
              maxCellCount
            } = this;
            
            return Array.from(maxCellCount, (_, index) => line[index] ?? "")
              .map(quoteString, this)
              .join(separator);
          }
        };
    
    return {
      parse(csv, {quote = "\"", separators = [","], forceLineFeedAfterCarriageReturn = true, ignoreLinefeedBeforeEOF = true, ignoreSpacesAfterQuotedString = true, taintQuoteSeparatorLines = false} = {}){
        csv = csv.replace((forceLineFeedAfterCarriageReturn
          ? strictLinebreakGroups
          : looseLinebreakGroups), "\n");
        csv += (ignoreLinefeedBeforeEOF && csv.endsWith("\n")
          ? ""
          : "\n");
        csv = csv.replaceAll("\0", "");
        quote = toCharArray(quote).filter(validQuotesAndSeparators)[0] ?? "";
        separators = toCharArray(separators).filter(validQuotesAndSeparators);
        
        const [
          header,
          ...rows
        ] = Array.from(csv)
          .reduce(tokenizeCells, {
            array: [
              [
                ""
              ]
            ],
            parserState: "empty",
            quote,
            separators,
            ignoreLinefeedBeforeEOF,
            taintQuoteSeparatorLines: taintQuoteSeparatorLines && separators.includes(quote),
            lineTaint: "none"
          }).array
          .map(parseSubArrays, {
            ignoreSpacesAfterQuotedString,
            quote
          });
        
        return {
          header,
          rows,
          mappedRows: rows.map(toHashMap, header)
        };
      },
      stringify(object, {quote = "\"", separator = ",", lineEnd = "\n", trimEmpty = true, lineEndBeforeEOF = false} = {}){
        let header = [],
          rows = [],
          mappedRows = [];
        
        quote = toCharArray(quote).filter(validQuotesAndSeparators)[0] ?? "\"";
        separator = toCharArray(separator).filter(validQuotesAndSeparators)[0] ?? ",";
        lineEnd = (lineEnd === "\r\n" || lineEnd === "\r"
          ? lineEnd
          : "\n");
        
        if(Array.isArray(object)){
          [
            header,
            ...rows
          ] = object;
        }
        else{
          ({
            header: [
              ...header
            ] = [],
            rows: [
              ...rows
            ] = [],
            mappedRows: [
              ...mappedRows
            ] = []
          } = object);
          
          if(rows.length === 0 && mappedRows.length > 0){
            rows = mappedRows.map(toRows, header);
          }
        }
        
        const allRows = [
            header,
            ...rows
          ],
          maxCellCount = {
            length: Math.max(...allRows.map(getLength))
          };
        
        if(trimEmpty){
          while(allRows.length > 0 && allRows[allRows.length - 1].every((string) => string.length === 0)){
            allRows.pop();
          }
          
          while(maxCellCount.length >= 0 && allRows.every((row) => !row[maxCellCount.length - 1] || row[maxCellCount.length - 1].length === 0)){
            allRows.forEach((row) => row.splice(maxCellCount.length - 1, 1));
            --maxCellCount.length;
          }
        }
        
        return allRows.map(toCSVLine, {
          quote,
          separator,
          maxCellCount
        }).join(lineEnd) + (lineEndBeforeEOF
          ? lineEnd
          : "");
      }
    };
  })();
