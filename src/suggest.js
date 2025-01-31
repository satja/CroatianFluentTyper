const NEW_SENTENCE_CHARS = [".", "?", "!"];
const REMOVE_SPACE_CHARS = [".", "?", "!", ",", ":", "—", "–", "-", "’"];
const NO_SPACE_AFTER_CHARS = ["—", "–", "-"];
const SPACE_CHARS = ["\xA0", " "];
const PAST_WORDS_COUNT = 2;
const SUGGESTIIBT_COUNT = 10;
const MIN_WORD_LENGHT_TO_PREDICT = 1;
const WORD_LIST_FILE = './data/word_list.json';
const NEXT_WORD_FILE = './data/next_word.json';
const SUGGESTIONS_FILE = './data/suggestions.json';

(async function () {
  class SuggestHandler {
    constructor() {
      // presage timeouts per tabId and frameId
      this.predictionTimeouts = {};
      // Number of suggestions
      this.numSuggestions = SUGGESTIIBT_COUNT;
      // Minimum characters typed by user to start prediction
      this.minWordLengthToPredict = MIN_WORD_LENGHT_TO_PREDICT;
      // Predict next word after separator char
      this.predictNextWordAfterSeparatorChar = MIN_WORD_LENGHT_TO_PREDICT === 0;
      // Automatically insert space after autocomplete
      this.insertSpaceAfterAutocomplete = true;
      // Capitalize the first word of each sentence
      this.autoCapitalize = true;
      // List of space-separated chars that will not trigger prediction if a word starts with it
      this.dontPredictChars = [];
      // Automatically remove space before: .!? characters.
      this.removeSpace = true;
      //Precompiled regular expressions
      this.separatorCharRegEx = RegExp(
        /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
      );
      this.whiteSpaceRegEx = RegExp(/\s+/);
      this.letterRegEx = RegExp(/^\p{L}/, "u");
      // Attach event listener
      window.addEventListener("message", this.messageHandler.bind(this));
      fetch(WORD_LIST_FILE).then(response => response.json()).then(json => {
        this.word_list = json;
      });
      fetch(SUGGESTIONS_FILE).then(response => response.json()).then(json => {
        this.suggestions = json;
      });
      fetch(NEXT_WORD_FILE).then(response => response.json()).then(json => {
        this.next_word = json;
      });
    }

    messageHandler(event) {
      const command = event.data.command;
      const context = event.data.context;
      switch (command) {
        case "backgroundPagePredictReq": {
          const tabId = event.data.context.tabId;
          const frameId = event.data.context.frameId;
          if (!this.predictionTimeouts[tabId]) {
            this.predictionTimeouts[tabId] = {};
          } else if (this.predictionTimeouts[tabId][frameId]) {
            clearTimeout(this.predictionTimeouts[tabId][frameId]);
          }
          this.predictionTimeouts[tabId][frameId] = setTimeout(
            this.runPrediction.bind(this, event),
            0
          );
          break;
        }
        case "backgroundPageSetConfig": {
          this.setConfig(
            context.numSuggestions,
            context.minWordLengthToPredict,
            context.insertSpaceAfterAutocomplete,
            context.autoCapitalize,
            context.dontPredictChars,
            context.removeSpace,
          );
          break;
        }
        default:
          console.log("Unknown message:");
          console.log(event);
      }
    }

    setConfig(
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      autoCapitalize,
      dontPredictChars,
      removeSpace,
    ) {
      this.numSuggestions = numSuggestions;
      this.minWordLengthToPredict = minWordLengthToPredict;
      this.predictNextWordAfterSeparatorChar = minWordLengthToPredict === 0;
      this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
      this.autoCapitalize = autoCapitalize;
      this.dontPredictChars = dontPredictChars.split(" ");
      this.removeSpace = removeSpace;
    }

    isLetter(character) {
      return this.letterRegEx.test(character);
    }

    isNumber(str) {
      return !isNaN(str) && !isNaN(parseFloat(str));
    }

    removePrevSentence(wordArray) {
      // Check for new sentence start
      // Use only words from new setence for prediction
      let newSentence = false;
      for (let index = wordArray.length - 1; index >= 0; index--) {
        const element = wordArray[index];

        if (
          // Checks for "." in wordArray
          NEW_SENTENCE_CHARS.includes(element) ||
          //Checks for "WORD." in wordArray
          NEW_SENTENCE_CHARS.includes(element.slice(-1))
        ) {
          wordArray = wordArray.splice(index + 1);
          newSentence = true;
          break;
        }
      }
      return { wordArray, newSentence };
    }

    processInput(predictionInput) {
      let doCapitalize = false;
      let doPrediction = false;
      if (
        typeof predictionInput === "string" ||
        predictionInput instanceof String
      ) {
        const endsWithSpace = predictionInput !== predictionInput.trimEnd();
        const endsWithSeparatorChar =
          !predictionInput ||
          predictionInput[predictionInput.length - 1]?.match(
            this.separatorCharRegEx
          );
        // Get last PAST_WORDS_COUNT words and filter empty
        const lastWordsArray = predictionInput
          .split(this.whiteSpaceRegEx) // Split on any whitespace
          .filter(function (e) {
            return e.trim(); // filter empty elements
          })
          .splice(-PAST_WORDS_COUNT); // Get last 3 words
        const { wordArray, newSentence } =
          this.removePrevSentence(lastWordsArray);
        const tokesArray = wordArray.join(" ").split(this.separatorCharRegEx);
        predictionInput = tokesArray.join(" ") + (endsWithSpace ? " " : "");
        const lastWord = tokesArray.length
          ? tokesArray[tokesArray.length - 1]
          : "";

        // Check if autoCapitalize should be run
        if (this.autoCapitalize) {
          const firstCharacterOfLastWord = lastWord.slice(0, 1);
          if (
            !endsWithSpace &&
            this.isLetter(firstCharacterOfLastWord) &&
            firstCharacterOfLastWord === firstCharacterOfLastWord.toUpperCase()
          ) {
            doCapitalize = true;
          } else if (
            newSentence &&
            ((!endsWithSpace && tokesArray.length === 1) ||
              (endsWithSpace && tokesArray.length === 0))
          ) {
            doCapitalize = true;
          }
        }

        // Check if we have valid precition input
        if (this.predictNextWordAfterSeparatorChar && endsWithSeparatorChar) {
          doPrediction = true;
        } else if (
          !endsWithSeparatorChar &&
          lastWord.length >= this.minWordLengthToPredict
        ) {
          if (this.isNumber(lastWord)) {
            doPrediction = false;
          } else if (
            lastWord.length &&
            this.dontPredictChars.includes(lastWord[0])
          ) {
            doPrediction = false;
          } else {
            doPrediction = true;
          }
        }
        doPrediction = doPrediction && this.numSuggestions > 0;
      }

      return { predictionInput, doPrediction, doCapitalize };
    }

    removeSpaceHandler(inputStr) { if (
        this.removeSpace &&
        REMOVE_SPACE_CHARS.includes(inputStr[inputStr.length - 1]) &&
        SPACE_CHARS.includes(inputStr[inputStr.length - 2]) &&
        !SPACE_CHARS.includes(inputStr[inputStr.length - 3])
      ) {
        const txt =
          inputStr[inputStr.length - 1] +
          (this.insertSpaceAfterAutocomplete &&
          !NO_SPACE_AFTER_CHARS.includes(inputStr[inputStr.length - 1])
            ? inputStr[inputStr.length - 2]
            : "");
        return {
          text: txt,
          length: 2,
        };
      }
      return null;
    }

    doPredictionHandler(predictionInput, lang) {
      const words = predictionInput.split(' ');
      var prev_word = '';
      if (words.length > 1)
          prev_word = words[words.length - 2].toLowerCase();
      const prefix = words[words.length - 1].toLowerCase();
      const predictions = [];
      if (prev_word + prefix[0] in this.next_word)
          for (var index of this.next_word[prev_word + prefix[0]]) {
            const word = this.word_list[index];
            if (word.startsWith(prefix)) {
                predictions.push(word);
                if (predictions.length == this.numSuggestions)
                    return predictions;
            }
          }
        if (prefix in this.suggestions)
            for (var index of this.suggestions[prefix]) {
                const word = this.word_list[index];
                if (!predictions.includes(word)) {
                    predictions.push(word);
                    if (predictions.length == this.numSuggestions)
                        return predictions;
                }
            }
      return predictions;
    }

    runPrediction(event) {
      const context = {
        ...event.data.context,
        predictions: [],
        forceReplace: null,
        triggerInputEvent: this.insertSpaceAfterAutocomplete,
      };
      const { predictionInput, doPrediction, doCapitalize } = this.processInput(
        event.data.context.text
      );
      const message = {
        command: "sandBoxPredictResp",
        context: context,
      };

      if (!doPrediction && event.data.context.text.length) {
        message.context.forceReplace = this.removeSpaceHandler(
          event.data.context.text
        );
      } else if (
        // Do prediction
        doPrediction
      ) {
        message.context.predictions = this.doPredictionHandler(
          predictionInput,
          context.lang
        );
      }
      // Add space if needed
      if (this.insertSpaceAfterAutocomplete) {
        // TODO: this might result in double space in some cases or a missing space.
        if (!REMOVE_SPACE_CHARS.includes(context.nextChar)) {
          message.context.predictions = message.context.predictions.map(
            (pred) => `${pred}\xA0`
          );
        }
      }
      // Auto capitalize if needed
      if (this.autoCapitalize && doCapitalize) {
        message.context.predictions = message.context.predictions.map(
          (pred) => pred.charAt(0).toUpperCase() + pred.slice(1)
        );
      }
      this.predictionTimeouts[event.data.context.tabId][
        event.data.context.frameId
      ] = null;
      event.source.postMessage(message, event.origin);
    }
  }

  new SuggestHandler();
})();
