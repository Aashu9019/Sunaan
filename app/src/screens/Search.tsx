import type React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import TrackRow from '../components/TrackRow';
import { Glass, Icon, IconBtn, Skeleton, Tap } from '../components/ui';
import { dispatch } from '../lib/player';
import { getJSON } from '../lib/server';
import type { Track } from '../lib/types';
import { c } from '../theme';
import { s as home } from './Home';

// Results update as you type; suggestions show while the box is focused.
export default function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const seq = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem('sunaan:recentSearch').then((r) => r && setRecent(JSON.parse(r)));
  }, []);

  const remember = (query: string) => {
    query = query.trim();
    if (!query) return;
    const next = [query, ...recent.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 8);
    setRecent(next);
    AsyncStorage.setItem('sunaan:recentSearch', JSON.stringify(next));
  };

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await getJSON<Track[]>(`/api/search?q=${encodeURIComponent(query)}`, []);
      if (my !== seq.current) return; // a newer search started
      setResults(r);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setSuggestions([]);
    const t = setTimeout(() => getJSON<string[]>(`/api/suggest?q=${encodeURIComponent(query)}`, []).then(setSuggestions), 120);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (x: string) => {
    setQ(x);
    remember(x);
    input.current?.blur();
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Text style={home.h1}>Search</Text>
        <Glass radius={16} style={st.box}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput
            ref={input}
            value={q}
            onChangeText={setQ}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => pick(q)}
            placeholder="Songs, artists"
            placeholderTextColor={c.muted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            style={st.input}
            selectionColor={c.accent}
          />
          {q.length > 0 && <IconBtn name="close" size={18} onPress={() => setQ('')} />}
          {loading && <Animated.View entering={FadeIn} style={st.busy} />}
        </Glass>

        {focused && q.trim().length > 0 && suggestions.length > 0 && (
          <Animated.View entering={FadeInDown.springify().damping(20)}>
            <Glass radius={18} style={{ marginTop: 8, padding: 6 }}>
              {suggestions.map((x) => (
                <Tap key={x} scale={0.98} style={st.suggest} onPress={() => pick(x)}>
                  <Icon name="search" size={15} color={c.muted} />
                  <Text style={st.suggestText}>{x}</Text>
                  <IconBtn name="arrow-up-outline" size={16} color={c.muted} style={{ transform: [{ rotate: '-45deg' }] }} onPress={() => setQ(x + ' ')} />
                </Tap>
              ))}
            </Glass>
          </Animated.View>
        )}

        {!q.trim() && recent.length > 0 && (
          <View style={st.chips}>
            {recent.map((r) => (
              <Tap key={r} onPress={() => pick(r)}>
                <Glass radius={99} style={st.chip}>
                  <Text style={{ color: c.text }}>{r}</Text>
                </Glass>
              </Tap>
            ))}
          </View>
        )}
      </View>

      {loading && !results.length ? (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12, paddingVertical: 7, alignItems: 'center' }}>
              <Skeleton w={50} h={50} radius={10} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton w="80%" h={11} />
                <Skeleton w="50%" h={11} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={q.trim().length >= 2 ? results : []}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 190 }}
          style={{ opacity: loading ? 0.55 : 1 }}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              i={index}
              onPlay={() => {
                remember(q);
                dispatch({ type: 'setQueue', queue: results.slice(index), index: 0 });
              }}
            />
          )}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, height: 50 },
  input: { flex: 1, color: c.text, fontSize: 17, paddingVertical: 0 },
  busy: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: c.accent, opacity: 0.7 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, borderRadius: 12 },
  suggestText: { flex: 1, color: c.text, fontSize: 15, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { paddingHorizontal: 15, paddingVertical: 8 },
});
