import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  conveneResourceTransportFailure,
  createConveneResourceReader,
  isConveneResourceLink,
  type ConveneResourceReaderState,
} from "@t3tools/client-runtime/convene-resource-reader";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Linking, Modal, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useTranslate } from "../../i18n";
import {
  SelectableMarkdownText,
  type NativeMarkdownTextStyle,
} from "../../native/SelectableMarkdownText";
import { conveneEnvironment } from "../../state/convene";
import { useAtomCommand } from "../../state/use-atom-command";

function ResourceDetail(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  uri: string;
  textStyle: NativeMarkdownTextStyle;
  onNavigate: (uri: string) => void;
}) {
  const t = useTranslate();
  const permitted = useAtomValue(
    conveneEnvironment.readResource.permissionAtom(props.environmentId),
  );
  const connection = useAtomValue(
    conveneEnvironment.status({ environmentId: props.environmentId, input: {} }),
  );
  const phase = AsyncResult.isSuccess(connection) ? connection.value.phase : undefined;
  const changes = useAtomValue(
    conveneEnvironment.resourceChanges({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const revision = AsyncResult.isSuccess(changes) ? changes.value : 0;
  const command = useAtomCommand(conveneEnvironment.readResource, { reportFailure: false });
  const [state, setState] = useState<ConveneResourceReaderState>({
    uri: props.uri,
    pending: true,
    result: null,
  });
  const [reader] = useState(() =>
    createConveneResourceReader(async (uri, page) => {
      const response = await command({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, uri, page },
      });
      return response._tag === "Success"
        ? response.value
        : conveneResourceTransportFailure(uri, squashAtomCommandFailure(response));
    }, setState),
  );
  useEffect(() => {
    if (permitted && phase !== "offline" && phase !== "unpaired") void reader.load(props.uri);
    return reader.clear;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Permission notifications invalidate the resource even when its URI is unchanged.
  }, [reader, props.uri, permitted, phase, revision]);
  const result = !permitted
    ? { status: "unauthorized" as const, resource_uri: props.uri }
    : phase === "offline" || phase === "unpaired"
      ? { status: "disconnected" as const, resource_uri: props.uri }
      : state.result;
  const ready = result?.status === "ready" ? result : null;
  const markdown = (body: string) => (
    <SelectableMarkdownText
      markdown={body}
      textStyle={props.textStyle}
      onLinkPress={(href) => {
        if (isConveneResourceLink(href)) props.onNavigate(href);
        else if (/^https?:\/\//.test(href)) void Linking.openURL(href);
      }}
    />
  );
  return (
    <>
      <View className="flex-row flex-wrap gap-2 px-4 py-3">
        <Button
          label={t("convene.resource.copyLink")}
          onPress={() => void Clipboard.setStringAsync(ready?.resource_uri ?? props.uri)}
        />
        <Button
          label={t("convene.resource.refresh")}
          disabled={state.pending}
          onPress={() => void reader.load(props.uri)}
        />
        {ready && (
          <Button
            label={t("convene.resource.openPlatform")}
            onPress={() => void Linking.openURL(ready.web_url)}
          />
        )}
      </View>
      <ScrollView
        key={props.uri}
        className="flex-1"
        contentContainerStyle={{ padding: 16, gap: 18 }}
      >
        <Text selectable className="text-xs text-foreground-muted">
          {props.uri}
        </Text>
        {state.pending && permitted && <Text>{t("convene.resource.loading")}</Text>}
        {result && result.status !== "ready" && (
          <Text accessibilityRole="alert">{t(`convene.resource.${result.status}`)}</Text>
        )}
        {ready && (
          <>
            <Text className="font-t3-bold text-lg text-foreground">
              #{ready.issue.number} {ready.issue.title}
            </Text>
            <Text className="text-foreground-muted">
              {t(
                ready.issue.state === "OPEN"
                  ? "convene.resource.issueStateOpen"
                  : "convene.resource.issueStateClosed",
              )}
            </Text>
            {ready.focused_comment_number !== null && (
              <Button
                label={t("convene.resource.viewIssue")}
                onPress={() => props.onNavigate(ready.issue.resource_uri)}
              />
            )}
            {ready.issue.body !== undefined && markdown(ready.issue.body)}
            {ready.comments.map((comment) => (
              <View
                key={comment.number}
                className={
                  comment.number === ready.focused_comment_number
                    ? "gap-2 rounded-xl border border-primary p-3"
                    : "gap-2 border-t border-border pt-3"
                }
              >
                <Button
                  tone="text"
                  label={t("convene.resource.comment", { number: comment.number })}
                  onPress={() => props.onNavigate(comment.resource_uri)}
                />
                {comment.is_deleted ? (
                  <Text className="text-foreground-muted">{t("convene.resource.deleted")}</Text>
                ) : (
                  markdown(comment.body ?? "")
                )}
              </View>
            ))}
            {ready.focused_comment_number === null &&
              ready.page * ready.page_size < ready.total && (
                <Button
                  label={t("convene.resource.moreComments")}
                  onPress={() => void reader.load(props.uri, ready.page + 1)}
                />
              )}
          </>
        )}
      </ScrollView>
    </>
  );
}

export function ConveneResourceModal(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  uri: string | null;
  textStyle: NativeMarkdownTextStyle;
  onNavigate: (uri: string) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.uri !== null} onRequestClose={props.onClose} animationType="slide">
      <View
        className="flex-1 bg-screen"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-border p-4">
          <Text className="font-t3-bold text-foreground">{t("convene.resource.title")}</Text>
          <Button tone="text" label={t("convene.resource.back")} onPress={props.onClose} />
        </View>
        {props.uri !== null && (
          <ResourceDetail
            key={`${props.environmentId}:${props.threadId}`}
            {...props}
            uri={props.uri}
          />
        )}
      </View>
    </Modal>
  );
}
