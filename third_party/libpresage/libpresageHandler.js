presage = null;

var presageCallback = {
    past_stream: "",

    get_past_stream: function() {
        return this.past_stream;
    },

    get_future_stream: function() {
        return "";
    }
};
var Module = {
    onRuntimeInitialized: function() {
        var pcObject = Module.PresageCallback.implement(presageCallback);
        presage = new Module.Presage(pcObject, "resources_js/presage.xml");
    }
};

function isString(s) {
    return typeof(s) === 'string' || s instanceof String;
}

window.addEventListener('message', function(event) {
    var command = event.data.command;
    var name = event.data.name || 'hello';
    switch (command) {
        case 'predictReq':
            if (presage && isString(event.data.context.text)) {
                presageCallback.past_stream = event.data.context.text;
                context = event.data.context;
                predictions = [];
                predictionsNative = presage.predict();
                if (predictionsNative.size()) {

                    for (var i = 0; i < predictionsNative.size(); i++) {
                        predictions.push(predictionsNative.get(i));
                    }
                    context.predictions = predictions;
                    var message = {
                        command: 'predictResp',
                        context: context
                    };
                    event.source.postMessage(message, event.origin);
                }
            }
            break;

            // case 'somethingElse':
            //   ...
    }

});