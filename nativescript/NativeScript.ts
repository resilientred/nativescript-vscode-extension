import {exec, ChildProcess} from 'child_process';
import {WebKitConnection} from '../webkit/webKitConnection';
import {AndroidDebugConnection} from './android/AndroidDebugConnection';
import {EventEmitter} from 'events';

export interface INSDebugConnection {
    on(eventName: string, handler: (msg: any) => void): void;

    attach(port: number, host?: string): Promise<void>;

    close(): void;

    debugger_setBreakpointByUrl(url: string, lineNumber: number, columnNumber: number): Promise<WebKitProtocol.Debugger.SetBreakpointByUrlResponse>

    debugger_removeBreakpoint(breakpointId: string): Promise<WebKitProtocol.Response>

    debugger_stepOver(): Promise<WebKitProtocol.Response>;

    debugger_stepIn(): Promise<WebKitProtocol.Response>;

    debugger_stepOut(): Promise<WebKitProtocol.Response>;

    debugger_resume(): Promise<WebKitProtocol.Response>;

    debugger_pause(): Promise<WebKitProtocol.Response>;

    debugger_evaluateOnCallFrame(callFrameId: string, expression: string, objectGroup?, returnByValue?: boolean): Promise<WebKitProtocol.Debugger.EvaluateOnCallFrameResponse>;

    debugger_setPauseOnExceptions(state: string): Promise<WebKitProtocol.Response>;

    debugger_getScriptSource(scriptId: WebKitProtocol.Debugger.ScriptId): Promise<WebKitProtocol.Debugger.GetScriptSourceResponse>;

    runtime_getProperties(objectId: string, ownProperties: boolean, accessorPropertiesOnly: boolean): Promise<WebKitProtocol.Runtime.GetPropertiesResponse>;

    runtime_evaluate(expression: string, objectGroup?: any, contextId?: number, returnByValue?: boolean): Promise<WebKitProtocol.Runtime.EvaluateResponse>;

    page_setOverlayMessage(message: string): Promise<WebKitProtocol.Response>;

    page_clearOverlayMessage(): Promise<WebKitProtocol.Response>;

}

export interface INSProject extends EventEmitter {
    platform(): string;

    projectPath(): string;

    debug(args: IAttachRequestArgs | ILaunchRequestArgs): Promise<void>;

    createConnection(): Promise<INSDebugConnection>;

    getDebugPort(): Promise<number>;
}

export abstract class NSProject extends EventEmitter implements INSProject {
    private _projectPath: string;

    constructor(projectPath: string) {
        this._projectPath = projectPath;
        super();
    }

    public projectPath(): string {
        return this._projectPath;
    }

    public abstract platform(): string;

    public abstract debug(args: IAttachRequestArgs | ILaunchRequestArgs): Promise<void>;

    public abstract createConnection(): Promise<INSDebugConnection>;

    public abstract getDebugPort(): Promise<number>;

}

export class IosProject extends NSProject {

    constructor(projectPath: string) {
        super(projectPath);
    }

    public platform(): string {
        return 'ios';
    }

    public debug(args: IAttachRequestArgs | ILaunchRequestArgs): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let error: string = this.isNotSupported();
            if (error !== null) {
                reject(error);
                return;
            }

            let that = this;
            let command: string = new CommandBuilder()
                .appendParam("debug")
                .appendParam(this.platform())
                .appendFlag("--emulator", args.emulator)
                .appendFlag("--start", args.request === "attach")
                .appendFlag("--debug-brk", args.request === "launch")
                .appendParam("--no-client")
                .build();

            let proxyIsReadyPhrase: string = 'Press Ctrl + C to terminate, or disconnect.';
            let cliIsReadyPhrase: string = 'Supressing debugging client.';
            let backendIsReadyPhrase: string = 'NativeScript waiting for debugger.';
            let proxyIsReady: boolean = false;
            let cliIsReady: boolean = false;
            let backendIsReady: boolean = false;
            let resolved: boolean = false;

            // run NativeScript CLI command
            let child: ChildProcess = exec(command, { cwd: this.projectPath() });
            child.stdout.on('data', function(data) {
                console.log(data);
                that.emit('TNS.outputMessage', data.toString(), 'log');
                if(!resolved) {
                    proxyIsReady = proxyIsReady || data.indexOf(proxyIsReadyPhrase) > -1;
                    cliIsReady = cliIsReady || data.indexOf(cliIsReadyPhrase) > -1;
                    backendIsReady = backendIsReady || data.indexOf(backendIsReadyPhrase) > -1;
                    if (args.request === 'launch' && proxyIsReady && cliIsReady && backendIsReady) {
                        resolved = true;
                        resolve();
                    }
                    else if(args.request === 'attach' && proxyIsReady && cliIsReady) {
                        resolved = true;
                        setTimeout(resolve, 1500); //resolve after a 1500ms
                    }
                }
            });
            child.stderr.on('data', function(data) {
                console.error(data.toString());
                that.emit('TNS.outputMessage', data.toString(), 'error');
            });
            child.on('close', function(code) {
                reject("The debug process exited unexpectedly");
            });
        });
    }

    public createConnection(): Promise<INSDebugConnection> {
        return Promise.resolve(new WebKitConnection());
    }

    public getDebugPort(): Promise<number> {
        return Promise.resolve(18181);
    }

    private isNotSupported(): string {
        if (!/^darwin/.test(process.platform)) {
            return 'iOS platform is supported only on Mac.';
        }
        return null;
    }
}

export class AndoridProject extends NSProject {
    private child: ChildProcess;

    constructor(projectPath: string) {
        super(projectPath);
    }

    public platform(): string {
        return 'android';
    }

    public debug(args: IAttachRequestArgs | ILaunchRequestArgs): Promise<void> {
        if (args.request === "attach") {
            return Promise.resolve<void>();
        }
        else if (args.request === "launch") {
            //TODO: interaction with CLI here
            //throw new Error("Launch on Android not implemented");
            let that = this;
            let launched = false;
            return new Promise<void>((resolve, reject) => {
                let command: string = new CommandBuilder()
                    .appendParam("debug")
                    .appendParam(this.platform())
                    .appendFlag("--emulator", args.emulator)
                    .appendFlag("--debug-brk", true)
                    //.appendFlag("--start", true)
                    //.appendFlag("--log trace", true)
                    .appendParam("--no-client")
                    .build();

                // run NativeScript CLI command
                let newEnv = process.env;
                //newEnv["ANDROID_HOME"] = "d:\\adt-bundle-windows-x86_64-20140702\\sdk\\";
                this.child = exec(command, { cwd: this.projectPath(), env: newEnv });
                this.child.stdout.on('data', function(data) {
                    let strData: string = data.toString();
                    console.log(data.toString());
                    that.emit('TNS.outputMessage', data.toString(), 'log');
                    if (!launched && args.request === "launch" && strData.indexOf('# NativeScript Debugger started #') > -1) {
                        that.child = null;
                        launched = true;

                        //wait a little before trying to connect, this gives a changes for adb to be able to connect to the debug socket
                        setTimeout(() => {
                            resolve();
                        }, 500);
                    }
                });

                this.child.stderr.on('data', function(data) {
                    console.error(data.toString());
                    that.emit('TNS.outputMessage', data.toString(), 'error');

                });
                this.child.on('close', function(code) {
                    that.child = null;
                    reject("The debug process exited unexpectedly");
                });
            });
        }
    }

    public createConnection(): Promise<INSDebugConnection> {
        return Promise.resolve(new AndroidDebugConnection());
    }

    public getDebugPort(): Promise<number> {
        //TODO: Call CLI to get the debug port
        //return Promise.resolve(40001);

        //return Promise.resolve(40001);

        let command: string = new CommandBuilder()
            .appendParam("debug")
            .appendParam(this.platform())
            .appendFlag("--get-port", true)
            .build();
        let that = this;
        // run NativeScript CLI command
        return new Promise<number>((resolve, reject) => {
            let child: ChildProcess = exec(command, { cwd: this.projectPath() });
            child.stdout.on('data', function(data) {
                that.emit('TNS.outputMessage', data.toString(), 'log');
                console.log("getDebugPort: " + data.toString());
                let regexp = new RegExp(" ([\\d]{5})", "g");

                //for the new output
                // var input = "device: 030b258308e6ce89 debug port: 40001";
                // var regexp = new RegExp("(?:^device: )([\\S]+)(?: debug port: )([\\d]+)", "g");
                // var match = regexp.exec(input);
                // console.log(match);

                let portNumberMatch = data.toString().match(regexp)
                console.log("port number match " + portNumberMatch);
                if (portNumberMatch) {
                    let portNumber = parseInt(portNumberMatch);
                    if (portNumber) {
                        console.log("port number " + portNumber);
                        child.stdout.removeAllListeners('data');
                        resolve(portNumber);
                    }
                }
            });
            child.stderr.on('data', function(data) {
                console.error(data.toString());
            });
            child.on('close', function(code) {
                reject(code);
            });
        });
    }
}

class CommandBuilder {
    private _command: string;

    constructor() {
        this._command = 'tns';
    }

    public appendParam(parameter: string): CommandBuilder {
        this._command += ' ' + parameter;
        return this;
    }

    public appendFlag(flagName: string, flagValue: boolean): CommandBuilder {
        if (flagValue) {
            this.appendParam(flagName);
        }
        return this;
    }

    public build(): string {
        return this._command;
    }
}