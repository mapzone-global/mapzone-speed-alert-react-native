import type { AlertSignRef } from '@mapzone/speed-alert';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  label: string;
  sign: AlertSignRef | null | undefined;
  /** Omit to hide the distance line (e.g. the current-limit slot). `0` reads as "here". */
  distMeters?: number;
  /** Landscape artwork (built-up area sign) instead of a round sign. */
  wide?: boolean;
};

/** One sign slot: the native image ref rendered by expo-image plus a caption. */
export function SignSlot({ label, sign, distMeters, wide }: Props) {
  return (
    <View style={styles.slot}>
      {sign ? (
        <Image source={sign} style={wide ? styles.wideImage : styles.image} contentFit="contain" />
      ) : (
        <View style={wide ? styles.wideEmpty : styles.empty} />
      )}
      <Text style={styles.label}>{label}</Text>
      {distMeters !== undefined && sign ? (
        <Text style={styles.dist}>{distMeters === 0 ? 'here' : `${distMeters} m`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', minWidth: 84, marginVertical: 4, marginHorizontal: 2 },
  image: { width: 72, height: 72 },
  empty: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: '#ccc' },
  wideImage: { width: 108, height: 72 },
  wideEmpty: { width: 108, height: 72, borderWidth: 1, borderColor: '#ccc' },
  label: { fontSize: 11, marginTop: 2 },
  dist: { fontSize: 11, color: '#555' },
});
