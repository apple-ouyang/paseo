import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Platform, Text, View } from "react-native";
import { z } from "zod";
import { MathMarkup, renderMathMarkup } from "./math-markup";

export const mathMessageSchema = z.object({
  segments: z.array(
    z.union([
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("math"), tex: z.string(), display: z.boolean() }),
    ]),
  ),
});

type MathMessageData = z.output<typeof mathMessageSchema>;

/**
 * Draws an assistant message whose math was split out by the transformer.
 *
 * Text segments use the timeline's foreground colour. Math segments are
 * typeset on web and fall back to their delimited source on native.
 *
 * The trade-off of replacing the source item: the host's markdown rendering
 * does not run for these messages, so code fences, tables and links inside a
 * message that also contains math render as plain text. Messages without math
 * are left to the host, which is why the transformer returns undefined for them.
 */
export function MathMessage({ item, theme }: PluginTimelineItemProps<MathMessageData>) {
  const color = theme.colors.foreground;
  const segments = item.data.segments;
  // Segments are immutable per item, so a content-derived key is stable across
  // re-renders and survives a streaming update that appends a segment.
  const rendered = useMemo(() => {
    const seen = new Map<string, number>();
    return segments.map((segment) => {
      const base =
        segment.kind === "math" ? `math:${segment.tex}` : `text:${segment.text.slice(0, 32)}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return {
        key: `${base}#${occurrence}`,
        markup:
          segment.kind === "math" && Platform.OS === "web"
            ? renderMathMarkup(segment.tex, segment.display)
            : null,
      };
    });
  }, [segments]);
  const styles = useMemo(() => ({ body: { color } }), [color]);
  return (
    <View>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <Text key={rendered[index].key} selectable style={styles.body}>
              {segment.text}
            </Text>
          );
        }
        return (
          <MathMarkup
            key={rendered[index].key}
            markup={rendered[index].markup}
            source={segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`}
            display={segment.display}
            color={color}
          />
        );
      })}
    </View>
  );
}
