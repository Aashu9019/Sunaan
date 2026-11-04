import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Glass, Icon, Tap } from '../components/ui';
import { joinRoom, leaveRoom, randomCode, roomStore } from '../lib/room';
import { conn } from '../lib/server';
import { toast } from '../lib/ui';
import { c } from '../theme';
import { s as home } from './Home';

export default function Room() {
  const { code, members, connected } = roomStore.use();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('sunaan:name').then((n) => n && setName(n));
  }, []);

  const go = (x: string) => {
    if (!name.trim()) return toast('Add your name');
    AsyncStorage.setItem('sunaan:name', name.trim());
    joinRoom(x, name.trim());
  };

  if (code)
    return (
      <ScrollView contentContainerStyle={home.page}>
        <Text style={home.h1}>Together</Text>
        <Animated.View entering={ZoomIn.duration(240)}>
          <Glass style={st.codeBox}>
            <View style={[st.dot, connected && st.dotOk]} />
            <Text style={st.code}>{code}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Tap style={st.primary} onPress={() => Share.share({ message: `Listen with me on Sunaan. Room ${code}\n${conn.get().base}/?room=${code}` })}>
                <Icon name="share-outline" size={18} color={c.accentInk} />
                <Text style={st.primaryText}>Invite</Text>
              </Tap>
              <Tap onPress={leaveRoom}>
                <Glass radius={99} style={st.pill}>
                  <Text style={{ color: c.text, fontWeight: '700' }}>Leave</Text>
                </Glass>
              </Tap>
            </View>
          </Glass>
        </Animated.View>
        <View style={st.members}>
          {members.map((m, i) => (
            <Animated.View key={m + i} entering={FadeInDown.delay(i * 60).duration(240)} style={st.member}>
              <Glass radius={30} style={st.avatar}>
                <Text style={{ color: c.accent, fontWeight: '800', fontSize: 19 }}>{m.slice(0, 1).toUpperCase()}</Text>
              </Glass>
              <Text numberOfLines={1} style={[home.sub, { maxWidth: 64 }]}>
                {m}
              </Text>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    );

  return (
    <ScrollView contentContainerStyle={home.page} keyboardShouldPersistTaps="handled">
      <Text style={home.h1}>Together</Text>
      <Glass style={{ padding: 18, gap: 12 }}>
        <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={c.muted} style={st.field} maxLength={24} />
        <Tap style={[st.primary, { justifyContent: 'center' }]} onPress={() => go(randomCode())}>
          <Text style={st.primaryText}>Start a room</Text>
        </Tap>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            placeholder="CODE"
            placeholderTextColor={c.muted}
            autoCapitalize="characters"
            maxLength={8}
            style={[st.field, { flex: 1, letterSpacing: 4 }]}
          />
          <Tap onPress={() => joinCode.trim() && go(joinCode)}>
            <Glass radius={99} style={[st.pill, { height: 50 }]}>
              <Text style={{ color: c.text, fontWeight: '700' }}>Join</Text>
            </Glass>
          </Tap>
        </View>
      </Glass>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  codeBox: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, gap: 16 },
  code: { color: c.text, fontSize: 54, fontWeight: '800', letterSpacing: 9 },
  dot: { position: 'absolute', top: 16, right: 16, width: 9, height: 9, borderRadius: 5, backgroundColor: c.muted },
  dotOk: { backgroundColor: '#5ee08a' },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 99, backgroundColor: c.accent },
  primaryText: { color: c.accentInk, fontWeight: '800', fontSize: 15 },
  pill: { height: 46, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  field: { backgroundColor: c.fill, borderRadius: 14, paddingHorizontal: 15, height: 50, color: c.text, fontSize: 16 },
  members: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, marginTop: 24 },
  member: { alignItems: 'center', gap: 6 },
  avatar: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
});
