import * as http from 'http';
import * as net from 'net';
import * as types from '../types';
import { HttpHeaders } from '../types';

export default class ExegesisResponseImpl implements types.ExegesisResponse {
    statusCode: number = 200;
    statusMessage: string | undefined = undefined;
    headers: types.HttpHeaders = Object.create(null);
    _body: any = undefined;
    ended: boolean = false;
    connection: net.Socket;

    constructor(res: http.ServerResponse /* | http2.Http2ServerResponse */) {
        this.connection = res.connection;
    }

    setStatus(status: number) {
        if(this.ended) {
            throw new Error("Trying to set status after response has been ended.");
        }
        this.statusCode = status;
        return this;
    }

    header(header: string, value: number | string | string[]) {
        this.setHeader(header, value);
        return this;
    }

    set(header: string, value: number | string | string[]) {
        this.setHeader(header, value);
        return this;
    }

    json(json: any) {
        if(this.ended) {
            throw new Error("Trying to set JSON content after response has been ended.");
        }
        this.body = json;
        this.ended = true;
    }

    setBody(body: any) : this {
        if(this.ended) {
            throw new Error("Trying to set body after response has been ended.");
        }
        this.body = body;
        this.ended = true;
        return this;
    }

    set body(body: any) {
        this._body = body;
        this.ended = true;
    }

    get body() : any {
        return this._body;
    }

    end() {
        this.ended = true;
    }

    setHeader(name: string, value: number | string | string[]) {
        if(this.ended) {
            throw new Error("Trying to set header after response has been ended.");
        }
        this.headers[name] = value;
    }

    getHeader(name: string) {
        return this.headers[name];
    }

    getHeaderNames() {
        return Object.keys(this.headers);
    }

    getHeaders() {
        return Object.assign({}, this.headers);
    }

    hasHeader(name: string) {
        return !!this.headers[name];
    }

    removeHeader(name: string) {
        if(this.ended) {
            throw new Error("Trying to remove header after response has been ended.");
        }
        delete this.headers[name];
    }

    writeHead(statusCode: number, statusMessage?: string | HttpHeaders, headers?: HttpHeaders) {
        if(statusMessage && typeof(statusMessage) !== 'string') {
            headers = statusMessage;
            statusMessage = undefined;
        }
        this.statusCode = statusCode;

        if(headers) {
            for(const headerName of Object.keys(headers)) {
                this.setHeader(headerName, headers[headerName]);
            }
        }
    }
}
