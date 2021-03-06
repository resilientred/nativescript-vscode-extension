import {OutputEvent, DebugSession, ErrorDestination} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';

import {WebKitDebugAdapter} from './webKitDebugAdapter';
import {LoggerHandler, Handlers, Tags} from '../common/logger';
import {Services} from '../services/debugAdapterServices';

import {AdapterProxy} from './adapter/adapterProxy';
import {LineNumberTransformer} from './adapter/lineNumberTransformer';
import {PathTransformer} from './adapter/pathTransformer';
import {SourceMapTransformer} from './adapter/sourceMaps/sourceMapTransformer';

export class WebKitDebugSession extends DebugSession {
    private _adapterProxy: AdapterProxy;

    public constructor(targetLinesStartAt1: boolean, isServer: boolean = false) {
        super(targetLinesStartAt1, isServer);

        // Logging on the std streams is only allowed when running in server mode, because otherwise it goes through
        // the same channel that Code uses to communicate with the adapter, which can cause communication issues.
        if (isServer) {
            Services.logger().addHandler(Handlers.stdStreamsHandler);
        }

        process.removeAllListeners('unhandledRejection');
        process.addListener('unhandledRejection', reason => {
            Services.logger().log(`******** ERROR! Unhandled promise rejection: ${reason}`);
        });

        this._adapterProxy = new AdapterProxy(
            [
                new LineNumberTransformer(targetLinesStartAt1),
                new SourceMapTransformer(),
                new PathTransformer()
            ],
            new WebKitDebugAdapter(),
            event => this.sendEvent(event));
    }

    /**
     * Overload sendEvent to log
     */
    public sendEvent(event: DebugProtocol.Event): void {
        if (event.event !== 'output') {
            // Don't create an infinite loop...
            Services.logger().log(`To client: ${JSON.stringify(event) }`);
        }

        super.sendEvent(event);
    }

    /**
     * Overload sendResponse to log
     */
    public sendResponse(response: DebugProtocol.Response): void {
        Services.logger().log(`To client: ${JSON.stringify(response) }`);
        super.sendResponse(response);
    }

    /**
     * Takes a response and a promise to the response body. If the promise is successful, assigns the response body and sends the response.
     * If the promise fails, sets the appropriate response parameters and sends the response.
     */
    private sendResponseAsync(request: DebugProtocol.Request, response: DebugProtocol.Response, responseP: Promise<any>): void {
        responseP.then(
            (body?) => {
                response.body = body;
                this.sendResponse(response);
            },
            e => {
                let eStr = e ? e.message : 'Unknown error';
                if (typeof e === "string" || e instanceof String)
                {
                    eStr = e;
                }


                if (eStr === 'Error: unknowncommand') {
                    this.sendErrorResponse(response, 1014, '[NSDebugAdapter] Unrecognized request: ' + request.command, null, ErrorDestination.Telemetry);
                    return;
                }

                if (request.command === 'evaluate') {
                    // Errors from evaluate show up in the console or watches pane. Doesn't seem right
                    // as it's not really a failed request. So it doesn't need the tag and worth special casing.
                    response.message = eStr;
                } else {
                    // These errors show up in the message bar at the top (or nowhere), sometimes not obvious that they
                    // come from the adapter
                    response.message = '[NSDebugAdapter] ' + eStr;
                    Services.logger().error('Error: ' + eStr, Tags.FrontendMessage);
                }

                response.success = false;
                this.sendResponse(response);
            });
    }

    /**
     * Overload dispatchRequest to dispatch to the adapter proxy instead of debugSession's methods for each request.
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        const response = { seq: 0, type: 'response', request_seq: request.seq, command: request.command, success: true  };
        try {
            Services.logger().log(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);
            this.sendResponseAsync(
                request,
                response,
                this._adapterProxy.dispatchRequest(request));
        } catch (e) {
            this.sendErrorResponse(response, 1104, 'Exception while processing request (exception: {_exception})', { _exception: e.message }, ErrorDestination.Telemetry);
        }
    }
}