import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

import {
  AccessRestrictionKind,
  configure,
  onLocation,
  setMutedAlertTypes,
  setVoiceProfile,
  setVoiceSpeed,
  useSpeedAlertSigns,
  VoiceAlertType,
  VoiceProfile,
} from '../index';

type Listener = (event: any) => void;

jest.mock('../MapZoneSpeedAlertModule', () => {
  const listeners: Record<string, Listener[]> = {};
  return {
    __esModule: true,
    default: {
      configure: jest.fn(),
      onLocation: jest.fn(),
      reset: jest.fn(),
      setMutedAlertTypes: jest.fn(),
      setVoiceProfile: jest.fn(),
      setVoiceSpeed: jest.fn(),
      addListener: jest.fn((eventName: string, listener: Listener) => {
        (listeners[eventName] ??= []).push(listener);
        return {
          remove: () => {
            listeners[eventName] = listeners[eventName].filter((l) => l !== listener);
          },
        };
      }),
      emit: (eventName: string, event: unknown) =>
        (listeners[eventName] ?? []).forEach((listener) => listener(event)),
      listenerCount: (eventName: string) => (listeners[eventName] ?? []).length,
    },
  };
});

const nativeModule = jest.requireMock('../MapZoneSpeedAlertModule').default;

const configureOptions = {
  baseUrl: 'https://example.invalid',
  apiKeyId: 'id',
  apiKey: 'key',
  vehicleId: 'vehicle',
  vehicleType: 1,
  seats: 4,
  weights: 1500,
};

function signRef() {
  return { release: jest.fn() };
}

beforeEach(() => jest.clearAllMocks());

describe('configure', () => {
  it('forwards https options to native', () => {
    configure(configureOptions);
    expect(nativeModule.configure).toHaveBeenCalledWith(configureOptions);
  });

  it('throws on a non-https baseUrl without calling native', () => {
    expect(() => configure({ ...configureOptions, baseUrl: 'http://example.invalid' })).toThrow(
      /https/
    );
    expect(nativeModule.configure).not.toHaveBeenCalled();
  });

  it.each([
    ['vehicleType', { vehicleType: Number.NaN }],
    ['seats', { seats: 4.5 }],
    ['weights', { weights: Number.POSITIVE_INFINITY }],
  ])('rejects a non-finite or fractional %s without calling native', (_, override) => {
    expect(() => configure({ ...configureOptions, ...override })).toThrow(TypeError);
    expect(nativeModule.configure).not.toHaveBeenCalled();
  });
});

describe('native forwarding', () => {
  const fix = {
    lat: 21.1,
    lng: 105.8,
    bearing: 90,
    speedKmh: 42,
    accuracy: 5,
    fixTimeMillis: 1_700_000_000_000,
  };

  it('passes the fix fields to onLocation in native order', () => {
    onLocation(fix);
    expect(nativeModule.onLocation).toHaveBeenCalledWith(21.1, 105.8, 90, 42, 5, 1_700_000_000_000);
  });

  it('rounds a fractional fix timestamp and rejects a non-finite one', () => {
    onLocation({ ...fix, fixTimeMillis: 1_700_000_000_000.6 });
    expect(nativeModule.onLocation).toHaveBeenLastCalledWith(
      21.1,
      105.8,
      90,
      42,
      5,
      1_700_000_000_001
    );

    expect(() => onLocation({ ...fix, fixTimeMillis: Number.NaN })).toThrow(TypeError);
    expect(nativeModule.onLocation).toHaveBeenCalledTimes(1);
  });

  it('maps enums to their raw native values', () => {
    setMutedAlertTypes([VoiceAlertType.SPEED_CAMERA, VoiceAlertType.NO_STOPPING]);
    expect(nativeModule.setMutedAlertTypes).toHaveBeenCalledWith([3, 19]);

    setVoiceProfile(VoiceProfile.DING_ONLY);
    expect(nativeModule.setVoiceProfile).toHaveBeenCalledWith(1);

    setVoiceSpeed(1.5);
    expect(nativeModule.setVoiceSpeed).toHaveBeenCalledWith(1.5);
  });
});

describe('useSpeedAlertSigns', () => {
  function renderHook() {
    const result: { current: ReturnType<typeof useSpeedAlertSigns> | null } = { current: null };
    function Probe() {
      result.current = useSpeedAlertSigns();
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(createElement(Probe));
    });
    return { result, renderer };
  }

  it('releases the refs of a superseded sign tick', () => {
    const { result, renderer } = renderHook();
    const first = { current: signRef(), next: null, camera: signRef(), toll: null };
    const second = { current: signRef(), next: null, camera: null, toll: null };

    act(() => nativeModule.emit('onSigns', { ...first, speedStatus: 0 }));
    act(() => nativeModule.emit('onSigns', { ...second, speedStatus: 0 }));

    expect(result.current?.signs?.current).toBe(second.current);
    expect(first.current.release).toHaveBeenCalledTimes(1);
    expect(first.camera.release).toHaveBeenCalledTimes(1);
    expect(second.current.release).not.toHaveBeenCalled();

    act(() => renderer.unmount());
    expect(second.current.release).toHaveBeenCalledTimes(1);
  });

  it('keeps each restriction group independent', () => {
    const { result, renderer } = renderHook();
    const image = signRef();

    act(() =>
      nativeModule.emit('onAccessRestriction', {
        image,
        kind: AccessRestrictionKind.ROAD_CLOSED,
        distMeters: 120,
      })
    );

    expect(result.current?.accessRestriction?.kind).toBe(AccessRestrictionKind.ROAD_CLOSED);
    expect(result.current?.stopRestriction).toBeNull();
    expect(result.current?.buildupArea).toBeNull();

    act(() => renderer.unmount());
    expect(image.release).toHaveBeenCalledTimes(1);
    expect(nativeModule.listenerCount('onAccessRestriction')).toBe(0);
  });
});
