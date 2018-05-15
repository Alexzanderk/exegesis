export default function httpHasBody(headers: {[header: string]: any}) : boolean {
    const contentLength = headers['content-length'];
    return !!headers['transfer-encoding'] ||
        (contentLength && contentLength !== '0' && contentLength !== 0);
}