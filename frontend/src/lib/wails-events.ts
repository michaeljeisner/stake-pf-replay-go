import { Events } from '@wailsio/runtime';

export function EventsOn<T = unknown>(eventName: string, callback: (data: T) => void): () => void {
  return Events.On(eventName, (event) => {
    callback(event.data as T);
  });
}
