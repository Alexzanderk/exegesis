import querystring from 'querystring';
import qs from 'qs';

import { ErrorType, ParametersMap, ParameterLocation } from '../../types';
import { ValidationError } from '../../errors';
import { pipeDelimitedParser, spaceDelimitedParser } from './delimitedParser';
import { generateStructuredParser } from './structuredParser';
import { getSimpleStringParser } from './simpleStringParser';
import { generatePathStyleParser } from './pathStyleParser';
import {
    RawStringParameterParser,
    ParameterParser,
    ValuesBag,
    ParameterDescriptor,
    MediaTypeParameterDescriptor,
    StyledParameterDescriptor
} from './types';

export * from './types';

function isMediaTypeParameterDescriptor(
    descriptor: ParameterDescriptor
) : descriptor is MediaTypeParameterDescriptor {
    return descriptor && (descriptor as any).contentType && (descriptor as any).parser;
}

export function generateParser(
    parameterDescriptor: ParameterDescriptor
) : ParameterParser {
    let answer : ParameterParser;
    if(isMediaTypeParameterDescriptor(parameterDescriptor)) {
        answer = generateMediaTypeParser(parameterDescriptor);
    } else {
        answer = generateStyleParser(parameterDescriptor);
    }
    return answer;
}

function generateMediaTypeParser(
    parameterDescriptor: MediaTypeParameterDescriptor
) : ParameterParser {
    // request and response are here for application/x-www-form-urlencoded.

    let answer : ParameterParser = (location: ParameterLocation, values: ValuesBag) : any => {
        try {
            let value = values[location.name];
            if(value === undefined || value === null) {return value;}

            if(parameterDescriptor.uriEncoded) {
                if(Array.isArray(value)) {
                    value = value.map(decodeURIComponent);
                } else {
                    value = decodeURIComponent(value);
                }
            }

            if(Array.isArray(value)) {
                return value.map(v => parameterDescriptor.parser.parseString(v));
            } else {
                return parameterDescriptor.parser.parseString(value);
            }
        } catch (err) {
            throw new ValidationError({
                type: ErrorType.Error,
                message: `Error parsing parameter ${location.name} of ` +
                    `type ${parameterDescriptor.contentType}: ${err.message}`,
                location
            });
        }
    };

    if(parameterDescriptor.required) {
        answer = requiredParameterWrapper(answer);
    }

    return answer;
}

function generateStyleParser(
    descriptor: StyledParameterDescriptor
) {
    const {schema, explode} = descriptor;
    let answer : ParameterParser;

    switch(descriptor.style) {
        case 'simple':
            answer = toStructuredParser(getSimpleStringParser(schema, explode));
            break;
        case 'form':
            answer = generateStructuredParser(schema, explode);
            break;
        case 'matrix':
            answer = generatePathStyleParser(schema, explode);
            break;
        case 'spaceDelimited':
            answer = spaceDelimitedParser;
            break;
        case 'pipeDelimited':
            answer = pipeDelimitedParser;
            break;
        case 'deepObject':
            answer = deepObjectParser;
            break;
        default:
            throw new Error(`Don't know how to parse parameters with style ${descriptor.style}`);
    }

    if(descriptor.required) {
        answer = requiredParameterWrapper(answer);
    }

    return answer;
}

/**
 * Returns a ParameterParser which is identical to `parser`, but which throws
 * a validation exception if the parameter is not found.
 *
 * @param parser - parser to wrap.
 */
function requiredParameterWrapper(
    parser: ParameterParser
) : ParameterParser {

    return function requiredParameter(
        location: ParameterLocation,
        rawParamValues: ValuesBag,
        rawValue: string,
        parserContext: any
    ) {
        const result = parser(location, rawParamValues, rawValue, parserContext);
        if(result === null || result === undefined) {
            throw new ValidationError({
                type: ErrorType.Error,
                message: `Missing required parameter ${location.name}`,
                location: location
            });
        }
        return result;
    };

}

function toStructuredParser(parser: RawStringParameterParser) {
    return (location: ParameterLocation, rawParamValues: ValuesBag) => {
        const value = rawParamValues[location.name];
        if(Array.isArray(value)) {
            return value.map(parser);
        } else {
            return parser(value);
        }
    };
}

function deepObjectParser(
    location: ParameterLocation,
    _rawParamValues: ValuesBag,
    rawValue: string,
    parserContext: any
) : any {
    if(!parserContext.qsParsed) {
        parserContext.qsParsed = qs.parse(rawValue);
    }
    const qsParsed = parserContext.qsParsed;
    return qsParsed[location.name];
}

function _parseParameterGroup(
    params: {
        location: ParameterLocation,
        parser: ParameterParser
    }[],
    rawValues: ValuesBag,
    rawQueryString: string
) : ParametersMap<any> {
    const parserContext = {};
    return params.reduce(
        (result: any, {location, parser}) => {
            result[location.name] = parser(location, rawValues, rawQueryString, parserContext);
            return result;
        },
        {}
    );
}

export function parseParameterGroup(
    params: {
        location: ParameterLocation,
        parser: ParameterParser
    }[],
    rawValues: ValuesBag
) : ParametersMap<any> {
    return _parseParameterGroup(params, rawValues, '');
}

export function parseQueryParameters(
    params: {
        location: ParameterLocation,
        parser: ParameterParser
    }[],
    query: string
) {
    const rawValues = querystring.parse(query, '&', '=', {decodeURIComponent: (val: string) => val});
    return _parseParameterGroup(params, rawValues, query);
}
