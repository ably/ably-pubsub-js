import { HTTPRequestImplementations } from '../http';
import XHRRequest from './xhrrequest';
import fetchRequest from './fetchrequest';

export const defaultBundledRequestImplementations: HTTPRequestImplementations = {
  XHRRequest: XHRRequest,
  FetchRequest: fetchRequest,
};

export const modularBundledRequestImplementations: HTTPRequestImplementations = {};
