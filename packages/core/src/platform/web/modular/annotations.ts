import * as API from '../../../../ably';
import Logger from '../../../common/lib/util/logger';
import { AnnotationsPlugin } from 'common/lib/client/modularplugins';
import RealtimeAnnotations from '../../../common/lib/client/realtimeannotations';
import RestAnnotations from '../../../common/lib/client/restannotations';
import Annotation, { WireAnnotation, fromEncoded, fromEncodedArray } from '../../../common/lib/types/annotation';

export const Annotations: AnnotationsPlugin = {
  Annotation,
  WireAnnotation,
  RealtimeAnnotations,
  RestAnnotations,
};

export const decodeAnnotation = ((obj, options) => {
  return fromEncoded(Logger.defaultLogger, obj, options);
}) as API.AnnotationStatic['fromEncoded'];

export const decodeAnnotations = ((obj, options) => {
  return fromEncodedArray(Logger.defaultLogger, obj, options);
}) as API.AnnotationStatic['fromEncodedArray'];
