import { urlError } from './utils';
import * as flags from './flags';
import _ from 'lodash';
import ajaxFetch from './fetch';

// Map from CRUD to HTTP for our default `sync` implementation.
const methodMap = Object.assign(Object.create(null), {
  create: 'POST',
  update: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  read: 'GET',
});

// sync
// ----

// Override this function to change the manner in which the library persists
// models to the server. You will be passed the type of request, and the model
// in question. By default, makes a RESTful Ajax request to the model's `url()`.
// Some possible customizations could be:
//
// * Use `setTimeout` to batch rapid-fire updates into a single request.
// * Send up the models as XML instead of JSON.
// * Persist models via WebSockets instead of Ajax.
//
// Turn on the `emulateHTTP` export in order to send `PUT` and `DELETE` requests
// as `POST`, with a `_method` parameter containing the true HTTP method, as
// well as all requests with the body as `application/x-www-form-urlencoded`
// instead of `application/json` with the model in a param named `model`. Useful
// when interfacing with server-side languages like **PHP** that make it
// difficult to read the body of `PUT` requests.
export let sync = function sync(method, model, options) {
  const type = methodMap[method];

  // Default options, unless specified.
  _.defaults(options || (options = {}), {
    emulateHTTP: flags.emulateHTTP,
    emulateJSON: flags.emulateJSON,
  });

  // Default JSON-request options.
  const params = { type, dataType: 'json' };

  // Ensure that we have a URL.
  if (!options.url) {
    params.url = _.result(model, 'url') || urlError();
  }

  // Ensure that we have the appropriate request data.
  if (
    options.data == null &&
    model &&
    (method === 'create' || method === 'update' || method === 'patch')
  ) {
    params.contentType = 'application/json';
    params.data = JSON.stringify(options.attrs || model.toJSON(options));
  }

  // For older servers, emulate JSON by encoding the request into an HTML-form.
  if (options.emulateJSON) {
    params.contentType = 'application/x-www-form-urlencoded';
    params.data = params.data ? { model: params.data } : {};
  }

  // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
  // And an `X-HTTP-Method-Override` header.
  if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
    params.type = 'POST';
    if (options.emulateJSON) params.data._method = type;
    const beforeSend = options.beforeSend;
    options.beforeSend = function (xhr) {
      xhr.setRequestHeader('X-HTTP-Method-Override', type);
      if (beforeSend) return beforeSend.apply(this, arguments);
    };
  }

  // Don't process data on a non-GET request.
  if (params.type !== 'GET' && !options.emulateJSON) {
    params.processData = false;
  }

  // Pass along `textStatus` and `errorThrown` from jQuery.
  const error = options.error;
  options.error = (xhr, textStatus, errorThrown) => {
    options.textStatus = textStatus;
    options.errorThrown = errorThrown;
    if (error) error.call(options.context, xhr, textStatus, errorThrown);
  };

  // Make the request, allowing the user to override any Ajax options.
  const xhr = (options.xhr = ajax(_.extend(params, options)));
  model.trigger('request', model, xhr, options);
  return xhr;
};

// Set the default implementation of `ajax` to proxy through to a fetch-based
// ajax implementation. Override this if you'd like to use a different library.
// eslint-disable-next-line prefer-const
export let ajax = ajaxFetch;

export function setSyncImplementation(impl) {
  sync = impl;
}

export function setAJAXImplementation(impl) {
  ajax = impl;
}
