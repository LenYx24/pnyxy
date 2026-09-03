/**
 * Coach-mark step lists per page. Each step's `target` matches a
 * `data-tour="<id>"` attribute on the element it points at. Steps whose
 * target isn't on the current layout are skipped by the engine, so the same
 * list is safe on desktop and mobile.
 */
import type { TFunction } from "i18next";
import type { CoachStep } from "./CoachMarks";

export function chatTourSteps(t: TFunction): CoachStep[] {
  return [
    {
      target: "chat-composer",
      title: t("onboarding.chat.composer.title"),
      body: t("onboarding.chat.composer.body"),
    },
    {
      target: "chat-model",
      title: t("onboarding.chat.model.title"),
      body: t("onboarding.chat.model.body"),
    },
    {
      target: "chat-new",
      title: t("onboarding.chat.new.title"),
      body: t("onboarding.chat.new.body"),
    },
  ];
}

export function readerTourSteps(t: TFunction): CoachStep[] {
  return [
    {
      target: "reader-toolbar",
      title: t("onboarding.reader.toolbar.title"),
      body: t("onboarding.reader.toolbar.body"),
    },
    {
      target: "reader-tools",
      title: t("onboarding.reader.tools.title"),
      body: t("onboarding.reader.tools.body"),
    },
  ];
}
