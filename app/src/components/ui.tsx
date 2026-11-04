import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { player } from '../lib/player';
import { c, spring } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export const Icon = ({ name, size = 22, color = c.text }: { name: IconName; size?: number; color?: string }) => (
  <Ionicons name={name} size={size} color={color} />
);

// Frosted glass: real blur on Android 12+, translucent fill elsewhere.
export function Glass({ style, children, strong, radius = 24 }: { style?: StyleProp<ViewStyle>; children?: ReactNode; strong?: boolean; radius?: number }) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.edge }, style]}>
      <BlurView
        intensity={strong ? 60 : 40}
        tint="dark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: strong ? c.glassStrong : c.glass }]} />
      {children}
    </View>
  );
}

// Pressable that springs down on touch, like iOS.
export function Tap({
  onPress,
  onLongPress,
  style,
  children,
  scale = 0.95,
  disabled,
  hitSlop,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  scale?: number;
  disabled?: boolean;
  hitSlop?: number;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => (s.value = withSpring(scale, spring))}
      onPressOut={() => (s.value = withSpring(1, spring))}
    >
      <Animated.View style={[style, a, disabled && { opacity: 0.35 }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function IconBtn({ name, onPress, size = 22, color, dim, style }: { name: IconName; onPress?: () => void; size?: number; color?: string; dim?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Tap onPress={onPress} scale={0.82} hitSlop={6} style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.55 : 1 }, style]}>
      <Icon name={name} size={size} color={color} />
    </Tap>
  );
}

export function Art({ uri, size, radius = 12, style }: { uri?: string; size: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: c.fill }, style]}>
      <Image source={uri} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={250} cachePolicy="memory-disk" />
    </View>
  );
}

// Three bouncing bars on whatever is playing.
export function Eq({ id }: { id: string }) {
  const { queue, index, playing } = player.use();
  if (queue[index]?.id !== id) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 14, gap: 2, marginHorizontal: 6 }}>
      {[0, 1, 2].map((i) => (
        <Bar key={i} delay={i * 160} playing={playing} />
      ))}
    </View>
  );
}

function Bar({ delay, playing }: { delay: number; playing: boolean }) {
  const h = useSharedValue(0.35);
  useEffect(() => {
    if (!playing) {
      cancelAnimation(h);
      return;
    }
    const t = setTimeout(() => {
      h.value = withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.3, { duration: 420 })), -1);
    }, delay);
    return () => clearTimeout(t);
  }, [playing]);
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: h.value }] }));
  return <Animated.View style={[{ width: 3, height: 14, borderRadius: 2, backgroundColor: c.accent, transformOrigin: 'bottom' }, a]} />;
}

export function Skeleton({ w, h, radius = 8, style }: { w: number | `${number}%`; h: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(0.9, { duration: 650 }), withTiming(0.4, { duration: 650 })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: w, height: h, borderRadius: radius, backgroundColor: c.fill }, a, style]} />;
}
