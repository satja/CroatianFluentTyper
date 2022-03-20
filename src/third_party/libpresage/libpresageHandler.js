import { SUPPORTED_LANGUAGES } from "./lang.js";

const NEW_SENTENCE_CHARS = [".", "?", "!", ","];
const REMOVE_SPACE_CHARS = [".", "?", "!", ",", ":", "—", "–", "-", "’"];
const NO_SPACE_AFTER_CHARS = ["—", "–", "-"];
const SPACE_CHARS = ["\xA0", " "];
const PAST_WORDS_COUNT = 5;
const SUGGESTIIBT_COUNT = 5;
const MIN_WORD_LENGHT_TO_PREDICT = 1;

(async function () {
  const { default: modP } = await import("./libpresage.js");
  const Module = await modP();

  class PresageHandler {
    constructor() {
      // last presage prediction per lang
      this.lastPrediction = {};
      // presage timeouts per tabId and frameId
      this.predictionTimeouts = {};
      // libPresage module
      this.libPresage = {};
      this.libPresageCallback = {};
      this.libPresageCallbackImpl = {};
      // Number of suggestion generated by presage engine
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
      this.removeSpace = false;
      // Text Expander config
      this.textExpansions = [];
      //Precompiled regular expressions
      this.separatorCharRegEx = RegExp(
        /\s+|!|"|#|\$|%|&|\(|\)|\*|\+|,|-|\.|\/|:|;|<|=|>|\?|@|\[|\\|\]|\^|_|`|{|\||}|~/
      );
      this.whiteSpaceRegEx = RegExp(/\s+/);
      this.letterRegEx = RegExp(/^\p{L}/, "u");
      this.numberRegEx = RegExp(/^\d+$/);
      // Attach event listener
      window.addEventListener("message", this.messageHandler.bind(this));
      SUPPORTED_LANGUAGES.forEach((lang) => {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.libPresageCallback[lang] = {
          pastStream: "",

          get_past_stream: function () {
            return this.pastStream;
          },

          get_future_stream: function () {
            return "";
          },
        };
        this.libPresageCallbackImpl[lang] = Module.PresageCallback.implement(
          this.libPresageCallback[lang]
        );
        this.libPresage[lang] = new Module.Presage(
          this.libPresageCallbackImpl[lang],
          "resources_js/presage_" + lang + ".xml"
        );
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
            context.textExpansions
          );
          break;
        }
        default:
          console.log("Unknown message:");
          console.log(event);
      }
    }

    setupTextExpansions() {
      let str = "";
      this.textExpansions.forEach((textExpansion) => {
        str += `${textExpansion[0]}\t${textExpansion[1]}\n`;
      });
      Module.FS.writeFile("/textExpansions.txt", str);
      for (const [, libPresage] of Object.entries(this.libPresage)) {
        libPresage.config(
          "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
          "/textExpansions.txt"
        );
      }
    }

    setConfig(
      numSuggestions,
      minWordLengthToPredict,
      insertSpaceAfterAutocomplete,
      autoCapitalize,
      dontPredictChars,
      removeSpace,
      textExpansions
    ) {
      this.numSuggestions = numSuggestions;
      this.minWordLengthToPredict = minWordLengthToPredict;
      this.predictNextWordAfterSeparatorChar = minWordLengthToPredict === 0;
      this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
      this.autoCapitalize = autoCapitalize;
      this.dontPredictChars = dontPredictChars.split(" ");
      this.removeSpace = removeSpace;
      this.textExpansions = textExpansions;
      this.setupTextExpansions();

      for (const [, libPresage] of Object.entries(this.libPresage)) {
        libPresage.config(
          "Presage.Selector.SUGGESTIONS",
          this.numSuggestions.toString()
        );
      }
    }

    isLetter(character) {
      return this.letterRegEx.test(character);
    }

    isNumber(str) {
      const match = str.match(this.numberRegEx);
      return Boolean(match);
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
        predictionInput = wordArray.join(" ") + (endsWithSpace ? " " : "");
        const lastWord = wordArray.length
          ? wordArray[wordArray.length - 1]
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
            ((!endsWithSpace && wordArray.length === 1) ||
              (endsWithSpace && wordArray.length === 0))
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

    removeSpaceHandler(inputStr) {
      if (
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

    runPrediction(event) {
      const context = event.data.context;
      const { predictionInput, doPrediction, doCapitalize } = this.processInput(
        event.data.context.text
      );
      const message = {
        command: "sandBoxPredictResp",
        context: context,
      };
      message.context.predictions = [];
      message.context.forceReplace = null;
      message.context.triggerInputEvent = this.insertSpaceAfterAutocomplete;
      if (!this.libPresage[context.lang]) {
        // Do nothing reply with empty predictions
      } else if (!doPrediction && event.data.context.text.length) {
        message.context.forceReplace = this.removeSpaceHandler(
          event.data.context.text
        );
      } else if (
        // Do prediction - return cached version
        doPrediction &&
        predictionInput === this.lastPrediction[context.lang].pastStream
      ) {
        message.context.predictions =
          this.lastPrediction[context.lang].predictions;
      } else if (doPrediction) {
        // Do prediction
        message.context.predictions = [];
        this.libPresageCallback[context.lang].pastStream = predictionInput;
        const predictionsNative =
          this.libPresage[context.lang].predictWithProbability();
        for (let i = 0; i < predictionsNative.size(); i++) {
          const result = predictionsNative.get(i);
          message.context.predictions.push(result.prediction);
          //result.probability
        }
        this.lastPrediction[context.lang].pastStream = predictionInput;
        this.lastPrediction[context.lang].predictions =
          message.context.predictions;
      }
      // Add space if needed
      if (this.insertSpaceAfterAutocomplete) {
        if (!context.nextChar.match(this.separatorCharRegEx)) {
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

  new PresageHandler();
})();
