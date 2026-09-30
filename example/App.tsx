import * as SpeedAlert from '@mapzone/speed-alert';
import {
  AccessRestrictionKind,
  BuildupAreaKind,
  StopRestrictionKind,
  VoiceAlertType,
  VoiceProfile,
  useSpeedAlertSigns,
} from '@mapzone/speed-alert';
import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { SAMPLE_TRACK_POLYLINE } from './src/fixtures/track';
import { startGpsSource } from './src/gps-source';
import { SignSlot } from './src/sign-slot';
import { TrackSimulator } from './src/track-simulator';

const extra = Constants.expoConfig?.extra as SpeedAlert.ConfigureOptions;

const MUTABLE_TYPES = Object.entries(VoiceAlertType).filter(
  (entry): entry is [string, VoiceAlertType] => typeof entry[1] === 'number'
);

const VOICE_SPEED_STEP = 0.25;

export default function App() {
  const { signs, accessRestriction, stopRestriction, buildupArea } = useSpeedAlertSigns();
  const [useGps, setUseGps] = useState(false);
  const [simulatorSpeedKmh, setSimulatorSpeedKmh] = useState(60);
  const [running, setRunning] = useState(false);
  const [voiceViaJs, setVoiceViaJs] = useState(false);
  const [dingOnly, setDingOnly] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [muted, setMuted] = useState<Set<VoiceAlertType>>(new Set());
  const [zone, setZone] = useState<SpeedAlert.ReadyEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const simulatorRef = useRef<TrackSimulator | null>(null);
  const stopGpsRef = useRef<(() => void) | null>(null);
  // Bumped on every Start/Reset so an awaited permission dialog can't revive a stale run.
  const runGeneration = useRef(0);

  const appendLog = useCallback((line: string) => {
    setLog((previous) => [`${new Date().toLocaleTimeString()} ${line}`, ...previous].slice(0, 30));
  }, []);

  const stopSources = useCallback(() => {
    runGeneration.current += 1;
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    stopGpsRef.current?.();
    stopGpsRef.current = null;
    setRunning(false);
  }, []);

  // configure once + always-on listeners
  useEffect(() => {
    try {
      SpeedAlert.configure(extra);
    } catch (error) {
      appendLog(String(error));
    }
    const subscriptions = [
      SpeedAlert.addResultListener((event) =>
        appendLog(`result ok=${event.success} code=${event.errorCode} ${event.errorMessage}`)
      ),
      SpeedAlert.addReadyListener((event) => {
        setZone(event);
        appendLog(`zone ready links=${event.linkCount} alerts=${event.alertCount}`);
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      stopSources();
      SpeedAlert.reset();
    };
  }, [appendLog, stopSources]);

  // Subscribing silences the built-in player; unsubscribing restores it.
  useEffect(() => {
    if (!voiceViaJs) return;
    const subscription = SpeedAlert.addVoiceListener((event) =>
      appendLog(
        `voice trigger=${event.trigger} priority=${event.priority} bytes=${event.wavBase64.length}`
      )
    );
    return () => subscription.remove();
  }, [voiceViaJs, appendLog]);

  useEffect(() => {
    if (simulatorRef.current) simulatorRef.current.speedKmh = simulatorSpeedKmh;
  }, [simulatorSpeedKmh]);

  const onStart = useCallback(async () => {
    stopSources();
    const generation = runGeneration.current;
    if (useGps) {
      let stop: () => void;
      try {
        stop = await startGpsSource(SpeedAlert.onLocation);
      } catch (error) {
        appendLog(String(error));
        return;
      }
      if (generation !== runGeneration.current) {
        stop(); // Reset/Start pressed while the permission dialog was open.
        return;
      }
      stopGpsRef.current = stop;
    } else {
      const simulator = new TrackSimulator(SAMPLE_TRACK_POLYLINE, SpeedAlert.onLocation, () => {
        appendLog('simulator reached end of track');
        setRunning(false);
      });
      simulator.speedKmh = simulatorSpeedKmh;
      simulatorRef.current = simulator;
      simulator.start();
    }
    appendLog(useGps ? 'started (GPS)' : 'started (simulator)');
    setRunning(true);
  }, [useGps, simulatorSpeedKmh, stopSources, appendLog]);

  const onReset = useCallback(() => {
    stopSources();
    SpeedAlert.reset();
    setZone(null);
    appendLog('reset()');
  }, [stopSources, appendLog]);

  const toggleMute = (type: VoiceAlertType) => {
    const next = new Set(muted);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setMuted(next);
    SpeedAlert.setMutedAlertTypes([...next]);
  };

  const onDingOnlyChange = (value: boolean) => {
    setDingOnly(value);
    SpeedAlert.setVoiceProfile(value ? VoiceProfile.DING_ONLY : VoiceProfile.FULL);
  };

  const changeVoiceSpeed = (delta: number) => {
    const next = Math.min(2, Math.max(0.5, voiceSpeed + delta));
    setVoiceSpeed(next);
    SpeedAlert.setVoiceSpeed(next);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>MapZone SpeedAlert example</Text>

        <Section title="Signs">
          <Text>
            speedStatus: {signs?.speedStatus ?? '-'} · zone:{' '}
            {zone ? `${zone.linkCount} links / ${zone.alertCount} alerts` : 'not loaded'}
          </Text>
          <View style={styles.row}>
            <SignSlot label="current" sign={signs?.current} />
            <SignSlot label="next" sign={signs?.next} distMeters={signs?.nextDistMeters} />
            <SignSlot label="camera" sign={signs?.camera} distMeters={signs?.cameraDistMeters} />
            <SignSlot label="toll" sign={signs?.toll} distMeters={signs?.tollDistMeters} />
          </View>
        </Section>

        <Section title="Restrictions">
          <View style={styles.row}>
            <SignSlot
              label={`access ${AccessRestrictionKind[accessRestriction?.kind ?? 0]}`}
              sign={accessRestriction?.image}
              distMeters={accessRestriction?.distMeters}
            />
            <SignSlot
              label={`stop ${StopRestrictionKind[stopRestriction?.kind ?? 0]}`}
              sign={stopRestriction?.image}
              distMeters={stopRestriction?.distMeters}
            />
            <SignSlot
              label={`bua ${BuildupAreaKind[buildupArea?.kind ?? 0]}`}
              sign={buildupArea?.image}
              distMeters={buildupArea?.distMeters}
              wide
            />
          </View>
        </Section>

        <Section title="Drive">
          <Toggle label="Use real GPS (else simulator)" value={useGps} onChange={setUseGps} />
          {!useGps && (
            <View style={styles.rowCenter}>
              <Text>Sim speed: {simulatorSpeedKmh} km/h </Text>
              <Button
                title="-10"
                onPress={() => setSimulatorSpeedKmh((speed) => Math.max(0, speed - 10))}
              />
              <Button
                title="+10"
                onPress={() => setSimulatorSpeedKmh((speed) => Math.min(150, speed + 10))}
              />
            </View>
          )}
          <View style={styles.rowCenter}>
            <Button title={running ? 'Restart' : 'Start'} onPress={onStart} />
            <Button title="Reset" onPress={onReset} />
          </View>
        </Section>

        <Section title="Voice">
          <Toggle
            label="Receive voice in JS (silences built-in player)"
            value={voiceViaJs}
            onChange={setVoiceViaJs}
          />
          <Toggle
            label="Ding only (VoiceProfile.DING_ONLY)"
            value={dingOnly}
            onChange={onDingOnlyChange}
          />
          <View style={styles.rowCenter}>
            <Text>Built-in speed: {voiceSpeed.toFixed(2)}x </Text>
            <Button title="-" onPress={() => changeVoiceSpeed(-VOICE_SPEED_STEP)} />
            <Button title="+" onPress={() => changeVoiceSpeed(VOICE_SPEED_STEP)} />
          </View>
          <Text style={styles.sub}>Mute:</Text>
          {MUTABLE_TYPES.map(([name, type]) => (
            <Toggle
              key={name}
              label={name}
              value={muted.has(type)}
              onChange={() => toggleMute(type)}
            />
          ))}
        </Section>

        <Section title="Log">
          {log.map((line, index) => (
            <Text key={index} style={styles.log}>
              {line}
            </Text>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.rowCenter}>
      <Switch value={value} onValueChange={onChange} />
      <Text style={styles.toggleLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  content: { padding: 12 },
  h1: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  sub: { marginTop: 6, fontWeight: '500' },
  section: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 2,
  },
  toggleLabel: { marginLeft: 6 },
  log: { fontSize: 11, fontFamily: 'monospace' },
});
