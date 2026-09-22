import { it, describe, expect } from 'vitest';
import { channelOptionsForReactHooks, version } from './AblyReactHooks.js';

describe('channelOptionsForReactHooks', () => {
  it('sets the react-hooks agent when no options are provided', () => {
    const options = channelOptionsForReactHooks();
    expect(options.params?.agent).toBe(`react-hooks/${version}`);
    expect(options.attachOnSubscribe).toBe(false);
  });

  it('sets the react-hooks agent when no agent is supplied', () => {
    const options = channelOptionsForReactHooks({ params: { rewind: '1' } });
    expect(options.params?.agent).toBe(`react-hooks/${version}`);
    expect(options.params?.rewind).toBe('1');
  });

  it('appends the react-hooks agent to a caller-supplied agent instead of overwriting it', () => {
    const options = channelOptionsForReactHooks({ params: { agent: 'ai-transport-js/1.2.3' } });
    expect(options.params?.agent).toBe(`ai-transport-js/1.2.3 react-hooks/${version}`);
  });

  it('preserves other caller-supplied params and options alongside the merged agent', () => {
    const options = channelOptionsForReactHooks({
      params: { agent: 'my-sdk/0.1.0', rewind: '5' },
      modes: ['presence', 'subscribe'],
    });
    expect(options.params?.agent).toBe(`my-sdk/0.1.0 react-hooks/${version}`);
    expect(options.params?.rewind).toBe('5');
    expect(options.modes).toEqual(['presence', 'subscribe']);
    expect(options.attachOnSubscribe).toBe(false);
  });
});
