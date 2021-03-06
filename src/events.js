import _ from 'lodash';
import { keys, keysIn } from './utils';

// Events
// ------

// A module that can be mixed in to *any object* in order to provide it with a
// custom event channel. You may bind a callback to an event with `on` or remove
// with `off`; `trigger`-ing an event fires all callbacks in succession.
//
//     var object = {};
//     _.extend(object, Events);
//     object.on('expand', function(){ alert('expanded'); });
//     object.trigger('expand');
//

// Regular expression used to split event strings.
const eventSplitter = /\s+/;

// A private singleton variable to share between listeners and listenees.
let _listening;

// Iterates over the standard `event, callback` (as well as the fancy multiple
// space-separated events `"change blur", callback` and jQuery-style event maps
// `{event: callback}`).
function eventsApi(iteratee, events, name, callback, opts) {
  if (name && typeof name === 'object') {
    // Handle event maps.
    if (callback !== void 0 && 'context' in opts && opts.context === void 0)
      opts.context = callback;
    for (const key of keys(name)) {
      events = eventsApi(iteratee, events, key, name[key], opts);
    }
  } else if (name && eventSplitter.test(name)) {
    // Handle space-separated event names by delegating them individually.
    for (const key of name.split(eventSplitter)) {
      events = iteratee(events, key, callback, opts);
    }
  } else {
    // Finally, standard events.
    events = iteratee(events, name, callback, opts);
  }
  return events;
}

// The reducing API that adds a callback to the `events` object.
function onApi(events, name, callback, options) {
  if (callback) {
    const handlers = events[name] || (events[name] = []);
    const context = options.context,
      ctx = options.ctx,
      listening = options.listening;
    if (listening) listening.count++;

    handlers.push({
      callback: callback,
      context: context,
      ctx: context || ctx,
      listening: listening,
    });
  }
  return events;
}

// The reducing API that removes a callback from the `events` object.
function offApi(events, name, callback, options) {
  if (!events) return;

  const context = options.context,
    listeners = options.listeners;

  // Delete all event listeners and "drop" events.
  if (!name && !context && !callback) {
    if (listeners) {
      for (const key of keys(listeners)) {
        listeners[key].cleanup();
      }
    }
    return;
  }

  const names = name ? [name] : keys(events);
  for (const key of names) {
    const handlers = events[key];

    // Bail out if there are no events stored.
    if (!handlers) break;

    // Find any remaining events.
    const remaining = [];
    for (let j = 0; j < handlers.length; j++) {
      const handler = handlers[j];
      if (
        (callback && callback !== handler.callback && callback !== handler.callback._callback) ||
        (context && context !== handler.context)
      ) {
        remaining.push(handler);
      } else {
        const listening = handler.listening;
        if (listening) listening.off(key, callback);
      }
    }

    // Replace events if there are any remaining. Otherwise, clean up.
    if (remaining.length) {
      events[key] = remaining;
    } else {
      delete events[key];
    }
  }

  return events;
}

// An try-catch guarded #on function, to prevent poisoning the global
// `_listening` variable.
function tryCatchOn(obj, name, callback, context) {
  try {
    obj.on(name, callback, context);
  } catch (e) {
    return e;
  }
}

// Reduces the event callbacks into a map of `{event: onceWrapper}`. `offer`
// unbinds the `onceWrapper` after it has been called.
function onceMap(map, name, callback, offer) {
  if (callback) {
    const once = (map[name] = _.once(function (...args) {
      offer(name, once);
      callback.apply(this, args);
    }));
    once._callback = callback;
  }
  return map;
}

// Handles triggering the appropriate event callbacks.
function triggerApi(objEvents, name, callback, args) {
  if (objEvents) {
    const events = objEvents[name];
    let allEvents = objEvents.all;
    if (events && allEvents) allEvents = allEvents.slice();
    if (events) triggerEvents(events, args);
    if (allEvents) triggerEvents(allEvents, [name].concat(args));
  }
  return objEvents;
}

// A difficult-to-believe, but optimized internal dispatch function for
// triggering events. Tries to keep the usual cases speedy (most internal events
// have 3 arguments).
function triggerEvents(events, args) {
  let ev,
    i = -1;
  const l = events.length,
    a1 = args[0],
    a2 = args[1],
    a3 = args[2];
  switch (args.length) {
    case 0:
      while (++i < l) (ev = events[i]).callback.call(ev.ctx);
      return;
    case 1:
      while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1);
      return;
    case 2:
      while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2);
      return;
    case 3:
      while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3);
      return;
    default:
      while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
      return;
  }
}

// Bind an event to a `callback` function. Passing `"all"` will bind the
// callback to all events fired.
function on(name, callback, context) {
  this._events = eventsApi(onApi, this._events || {}, name, callback, {
    context: context,
    ctx: this,
    listening: _listening,
  });

  if (_listening) {
    const listeners = this._listeners || (this._listeners = {});
    listeners[_listening.id] = _listening;
    // Allow the listening to use a counter, instead of tracking callbacks
    // for library interop
    _listening.interop = false;
  }

  return this;
}

// Remove one or many callbacks. If `context` is null, removes all callbacks
// with that function. If `callback` is null, removes all callbacks for the
// event. If `name` is null, removes all bound callbacks for all events.
function off(name, callback, context) {
  if (!this._events) return this;
  this._events = eventsApi(offApi, this._events, name, callback, {
    context: context,
    listeners: this._listeners,
  });

  return this;
}

export const Events = {
  on,

  // Inversion-of-control versions of `on`. Tell *this* object to listen to an
  // event in another object... keeping track of what it's listening to for
  // easier unbinding later.
  listenTo(obj, name, callback) {
    if (!obj) return this;
    const id = obj._listenId || (obj._listenId = _.uniqueId('l'));
    const listeningTo = this._listeningTo || (this._listeningTo = Object.create(null));
    let listening = (_listening = listeningTo[id]);

    // This object is not listening to any other events on `obj` yet. Setup
    // the necessary references to track the listening callbacks.
    if (!listening) {
      this._listenId || (this._listenId = _.uniqueId('l'));
      listening = _listening = listeningTo[id] = new Listening(this, obj);
    }

    // Bind callbacks on obj.
    const error = tryCatchOn(obj, name, callback, this);
    _listening = void 0;

    if (error) throw error;
    // If the target obj is not Events, track events manually.
    if (listening.interop) listening.on(name, callback);

    return this;
  },

  off,

  // Tell this object to stop listening to either specific events ... or to
  // every object it's currently listening to.
  stopListening(obj, name, callback) {
    const listeningTo = this._listeningTo;
    if (!listeningTo) return this;

    const ids = obj ? [obj._listenId] : keysIn(listeningTo);
    for (let i = 0; i < ids.length; i++) {
      const listening = listeningTo[ids[i]];

      // If listening doesn't exist, this object is not currently
      // listening to obj. Break out early.
      if (!listening) break;

      listening.obj.off(name, callback, this);
      if (listening.interop) listening.off(name, callback);
    }
    if (_.isEmpty(listeningTo)) this._listeningTo = void 0;

    return this;
  },

  // Bind an event to only be triggered a single time. After the first time
  // the callback is invoked, its listener will be removed. If multiple events
  // are passed in using the space-separated syntax, the handler will fire
  // once for each event, not once for a combination of all events.
  once(name, callback, context) {
    // Map the event into a `{event: once}` object.
    const events = eventsApi(onceMap, {}, name, callback, this.off.bind(this));
    if (typeof name === 'string' && context == null) callback = void 0;
    return this.on(events, callback, context);
  },

  // Inversion-of-control versions of `once`.
  listenToOnce(obj, name, callback) {
    // Map the event into a `{event: once}` object.
    const events = eventsApi(onceMap, {}, name, callback, this.stopListening.bind(this, obj));
    return this.listenTo(obj, events);
  },

  // Trigger one or many events, firing all bound callbacks. Callbacks are
  // passed the same arguments as `trigger` is, apart from the event name
  // (unless you're listening on `"all"`, which will cause your callback to
  // receive the true name of the event as the first argument).
  trigger(name, ...args) {
    if (!this._events) return this;

    eventsApi(triggerApi, this._events, name, void 0, args);
    return this;
  },

  // Aliases for backwards compatibility.
  bind: on,
  unbind: off,
};

// A listening class that tracks and cleans up memory bindings when all
// callbacks have been offed.
const Listening = /*#__PURE__*/ (() => {
  // eslint-disable-next-line no-shadow
  const Listening = class Listening {
    constructor(listener, obj) {
      this.id = listener._listenId;
      this.listener = listener;
      this.obj = obj;
      this.interop = true;
      this.count = 0;
      this._events = void 0;
    }

    // Offs a callback (or several).
    // Uses an optimized counter if the listenee uses Events. Otherwise, falls
    // back to manual tracking to support events library interop.
    off(name, callback) {
      let cleanup;
      if (this.interop) {
        this._events = eventsApi(offApi, this._events, name, callback, {
          context: void 0,
          listeners: void 0,
        });
        cleanup = !this._events;
      } else {
        this.count--;
        cleanup = this.count === 0;
      }
      if (cleanup) this.cleanup();
    }

    // Cleans up memory bindings between the listener and the listenee.
    cleanup() {
      delete this.listener._listeningTo[this.obj._listenId];
      if (!this.interop) delete this.obj._listeners[this.id];
    }
  };

  Listening.prototype.on = Events.on;

  return Listening;
})();
