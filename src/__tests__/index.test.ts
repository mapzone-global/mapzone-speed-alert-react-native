import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

import {
  AccessRestrictionKind,
  addSnappedLocationListener,
  configure,
  logout,
  onLocation,
  setMutedAlertTypes,
  setVoiceProfile,
  setVoiceSpeed,
  useSpeedAlertSigns,
  VehicleType,
  VoiceAlertType,
  VoiceProfile,
} from '../index';

type Listener = (event: any) => void;

jest.mock('../MapZoneSpeedAlertModule', () => {
  const listeners: Record<string, Listener[]> = {};
  return {
    __esModule: true,
    default: {
      configure: jest.fn(() => null),
      logout: jest.fn(),
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
  identity: '+84901234567',
  vehicleType: VehicleType.TRUCK,
  seats: 4,
  weightsTons: 1.5,
};

const nativeConfigureOptions = { ...configureOptions, metadata: null };

function signRef() {
  return { release: jest.fn() };
}

beforeEach(() => jest.clearAllMocks());

describe('configure', () => {
  it('forwards https options to native with metadata serialised', async () => {
    await configure({ ...configureOptions, metadata: { appVersion: '1.4.0' } });
    expect(nativeModule.configure).toHaveBeenCalledWith({
      ...nativeConfigureOptions,
      metadata: '{"appVersion":"1.4.0"}',
    });
  });

  it('passes a missing metadata as null', async () => {
    await configure(configureOptions);
    expect(nativeModule.configure).toHaveBeenCalledWith(nativeConfigureOptions);
  });

  it('reaches native synchronously, in call order with the fixes that follow', () => {
    const first = configure(configureOptions);
    const second = configure({ ...configureOptions, identity: '+84900000000' });
    onLocation({ lat: 21, lng: 105, bearing: 0, speedKmh: 0, accuracy: 5, fixTimeMillis: 1 });

    const [configureA, configureB] = nativeModule.configure.mock.invocationCallOrder;
    const [fix] = nativeModule.onLocation.mock.invocationCallOrder;
    expect(configureA).toBeLessThan(configureB);
    expect(configureB).toBeLessThan(fix);
    return Promise.all([first, second]);
  });

  it('turns a native throw into a rejection', async () => {
    nativeModule.configure.mockImplementationOnce(() => {
      throw new Error('application id could not be resolved');
    });
    await expect(configure(configureOptions)).rejects.toThrow(
      'application id could not be resolved'
    );
  });

  it('rejects with the native reason when native refuses the configuration', async () => {
    nativeModule.configure.mockReturnValueOnce('identity must not be empty');
    await expect(configure({ ...configureOptions, identity: '' })).rejects.toThrow(
      'MapZoneSpeedAlert.configure: identity must not be empty'
    );
  });

  it('accepts a promise from native (iOS) the same way', async () => {
    nativeModule.configure.mockReturnValueOnce(Promise.resolve('metadata is not a JSON object'));
    await expect(configure(configureOptions)).rejects.toThrow('metadata is not a JSON object');
  });

  it('rejects a non-https baseUrl without calling native', async () => {
    await expect(
      configure({ ...configureOptions, baseUrl: 'http://example.invalid' })
    ).rejects.toThrow(/https/);
    expect(nativeModule.configure).not.toHaveBeenCalled();
  });

  it.each([
    ['vehicleType', { vehicleType: Number.NaN }],
    ['vehicleType outside VehicleType', { vehicleType: 6 }],
    ['seats', { seats: 4.5 }],
    ['weightsTons', { weightsTons: Number.POSITIVE_INFINITY }],
  ])('rejects an invalid %s without calling native', async (_, override) => {
    await expect(configure({ ...configureOptions, ...override })).rejects.toThrow(TypeError);
    expect(nativeModule.configure).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  function answer(requestId: number, result = { success: true, errorCode: 0, errorMessage: '' }) {
    nativeModule.emit('onLogoutResult', { requestId, ...result });
  }

  it('resolves with the native answer to its own request, failure included', async () => {
    const loggedOut = logout();
    const [requestId] = nativeModule.logout.mock.calls[0];
    const failure = { success: false, errorCode: -4, errorMessage: 'Server unreachable.' };

    answer(requestId + 1000);
    answer(requestId, failure);

    await expect(loggedOut).resolves.toEqual(failure);
    expect(nativeModule.listenerCount('onLogoutResult')).toBe(0);
  });

  it('gives each call its own request id', async () => {
    const first = logout();
    const second = logout();
    const [[firstId], [secondId]] = nativeModule.logout.mock.calls;
    expect(firstId).not.toBe(secondId);

    answer(secondId);
    answer(firstId, { success: false, errorCode: -8, errorMessage: 'Device not ready.' });
    await expect(first).resolves.toMatchObject({ errorCode: -8 });
    await expect(second).resolves.toMatchObject({ success: true });
  });

  it('reaches native synchronously, so a following configure cannot overtake it', async () => {
    const loggedOut = logout();
    const configured = configure({ ...configureOptions, identity: '+84900000000' });

    const [logoutCall] = nativeModule.logout.mock.invocationCallOrder;
    const [configureCall] = nativeModule.configure.mock.invocationCallOrder;
    expect(logoutCall).toBeLessThan(configureCall);
    await configured;

    answer(nativeModule.logout.mock.calls[0][0]);
    await loggedOut;
  });

  it('rejects and unsubscribes when the native call throws', async () => {
    nativeModule.logout.mockImplementationOnce(() => {
      throw new Error('native module unavailable');
    });
    await expect(logout()).rejects.toThrow('native module unavailable');
    expect(nativeModule.listenerCount('onLogoutResult')).toBe(0);
  });
});

describe('addSnappedLocationListener', () => {
  it('delivers native snapped locations until removed', () => {
    const listener = jest.fn();
    const subscription = addSnappedLocationListener(listener);
    const event = { latitude: 21.1, longitude: 105.8, bearingDegrees: 270 };

    nativeModule.emit('onSnappedLocation', event);
    subscription.remove();
    nativeModule.emit('onSnappedLocation', event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
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
