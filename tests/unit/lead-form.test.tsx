import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const submitAndConfirmLeadMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/forms/gas-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/forms/gas-client")>();
  return { ...original, submitAndConfirmLead: submitAndConfirmLeadMock };
});

import { LeadForm } from "@/components/lead/LeadForm";
import { ResultView } from "@/components/quest/ResultView";
import type { Talk } from "@/lib/content/talk-types";
import {
  GasNotFoundError,
  GasTimeoutError,
  GasTransportError,
} from "@/lib/forms/gas-client";

const preparationMessage = "現在、受付機能を準備しています。資料の閲覧と診断はご利用いただけます。";
const endpoint = "https://script.google.com/macros/s/test/exec";
const submittedEmail = ["asako", "example.com"].join("@");
const savedReceipt = {
  submissionId: "6c686afa-3ad2-4dab-94a4-bd616198bbed",
  status: "saved" as const,
};

const baseProps = {
  talkSlug: "ai-president-intro",
  eventName: "THA AI社長 登壇セッション",
  resultStage: "experiment" as const,
  consentText: "入力いただいた情報は、資料送付またはAI活用相談の対応にのみ使用します。",
  privacyPolicyUrl: "https://talk.example/privacy",
};

const talkFixture: Talk = {
  slug: baseProps.talkSlug,
  title: "AI社長",
  speaker: "西山朝子",
  eventName: baseProps.eventName,
  published: true,
  scenes: [],
  questions: [],
  results: [{
    stage: "experiment",
    title: "実験期",
    rpgSubtitle: "魔法を試す勇者",
    description: "学びを残す段階です。",
    nextQuest: "共有しましょう。",
  }],
  lead: {
    downloadEnabled: true,
    downloadUrl: "/downloads/action-sheet.pdf",
    formHeading: "次の一歩を、会社の資産にする。",
    consentText: baseProps.consentText,
    thankYouMessage: "お申し込みを受け付けました。",
    consultationCta: "AI活用を相談する",
    privacyPolicyUrl: baseProps.privacyPolicyUrl,
  },
};

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve: Deferred<Value>["resolve"] = () => undefined;
  let reject: Deferred<Value>["reject"] = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function enableGas() {
  vi.stubEnv("NEXT_PUBLIC_GAS_WEB_APP_URL", endpoint);
  vi.stubEnv("NEXT_PUBLIC_PRIVACY_POLICY_URL", baseProps.privacyPolicyUrl);
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("会社名"), "THA株式会社");
  await user.type(screen.getByLabelText("お名前（任意）"), "西山朝子");
  await user.type(screen.getByLabelText("メールアドレス"), submittedEmail);
  await user.click(screen.getByLabelText(/個人情報の取り扱いに同意する/));
}

function installDataLayer() {
  const dataLayer: Array<Record<string, unknown>> = [];
  (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer = dataLayer;
  return dataLayer;
}

afterEach(() => {
  cleanup();
  submitAndConfirmLeadMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  Reflect.deleteProperty(window, "dataLayer");
});

describe("ResultView lead actions", () => {
  it("shows the diagnosis value before revealing either personal-information form", async () => {
    const user = userEvent.setup();
    render(<ResultView talk={talkFixture} result={{ total: 4, stage: "experiment" }} />);

    expect(screen.getByText("YOUR AI MANAGEMENT STAGE")).toBeVisible();
    expect(screen.getByRole("heading", { name: "実験期" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "NEXT QUEST" })).toBeVisible();
    expect(screen.queryByLabelText("会社名")).toBeNull();

    await user.click(screen.getByRole("button", { name: "個別アクションシートを受け取る" }));

    expect(screen.getByRole("heading", { name: "次の一歩を、会社の資産にする。" })).toBeVisible();
    expect(screen.getByLabelText("会社名")).toBeVisible();
    expect(screen.getByText(preparationMessage)).toBeVisible();
  });

  it("renders configured result and next-action labels", () => {
    render(<ResultView
      talk={{
        ...talkFixture,
        presentation: {
          resultEyebrow: "YOUR TIME-ASSET STAGE",
          nextActionLabel: "FIRST STEP",
        },
      }}
      result={{ total: 4, stage: "experiment" }}
    />);

    expect(screen.getByText("YOUR TIME-ASSET STAGE")).toBeVisible();
    expect(screen.getByRole("heading", { name: "FIRST STEP" })).toBeVisible();
  });

  it("opens the configured consultation form with its semantic topics", async () => {
    const user = userEvent.setup();
    render(<ResultView
      talk={{
        ...talkFixture,
        lead: {
          ...talkFixture.lead,
          consultationCta: "会社らしさの継承を相談する",
          consultationHeading: "会社らしさと時間資産の継承を相談する",
          consultationTopics: [
            { value: "succession", label: "次世代への事業承継について相談したい" },
            { value: "time-assets", label: "会社らしさ・判断資産の言語化について相談したい" },
            { value: "other", label: "その他" },
          ],
        },
      }}
      result={{ total: 4, stage: "experiment" }}
    />);

    await user.click(screen.getByRole("button", { name: "会社らしさの継承を相談する" }));

    expect(screen.getByRole("heading", { name: "会社らしさと時間資産の継承を相談する" })).toBeVisible();
    expect(screen.getByLabelText("次世代への事業承継について相談したい")).toBeVisible();
    expect(screen.getByLabelText("会社らしさ・判断資産の言語化について相談したい")).toBeVisible();
    expect(screen.queryByLabelText("AI社長について相談したい")).toBeNull();
    expect(screen.getByRole("button", { name: "相談を申し込む" })).toBeDisabled();
  });
});

describe("LeadForm truthful GAS states", () => {
  it.each([
    "",
    "not a URL",
    "http://gas.example/exec",
    "http://127.0.0.2:8787/exec",
    "https://gas.example/macros/s/test/exec",
    "https://script.google.com.example/macros/s/test/exec",
    "https://www.script.google.com/macros/s/test/exec",
    "https://script.google.com/macros/s/test/exec?mode=prod",
    "https://script.google.com/macros/s/test/exec#prod",
    "https://script.google.com/macros/s/test/exec/",
    ["https://user:password", "script.google.com/macros/s/test/exec"].join("@"),
  ])("keeps an invalid or blank endpoint in a truthful preparation state: %s", async (configuredEndpoint) => {
    vi.stubEnv("NEXT_PUBLIC_GAS_WEB_APP_URL", configuredEndpoint);
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_POLICY_URL", baseProps.privacyPolicyUrl);
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);

    expect(screen.getByText(preparationMessage)).toBeVisible();
    const button = screen.getByRole("button", { name: "資料を受け取る" });
    expect(button).toBeDisabled();

    fireEvent.submit(button.closest("form")!);

    expect(submitAndConfirmLeadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
  });

  it.each([
    [endpoint, "", "GAS only"],
    ["", baseProps.privacyPolicyUrl, "privacy only"],
    [endpoint, "http://privacy.example/policy", "HTTP privacy"],
    [endpoint, ["https://user:password", "privacy.example/policy"].join("@"), "privacy credentials"],
  ])("fails a partial or invalid activation pair closed: %s", (gasUrl, privacyUrl) => {
    vi.stubEnv("NEXT_PUBLIC_GAS_WEB_APP_URL", gasUrl);
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_POLICY_URL", privacyUrl);
    render(<LeadForm
      {...baseProps}
      privacyPolicyUrl={undefined}
      intent="download"
      downloadUrl="/downloads/action-sheet.pdf"
    />);

    expect(screen.getByText(preparationMessage)).toBeVisible();
    expect(screen.getByRole("button", { name: "資料を受け取る" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "プライバシーポリシー" })).toBeNull();
    expect(submitAndConfirmLeadMock).not.toHaveBeenCalled();
  });

  it("submits the strict lead, then reveals approved downloads only after saved", async () => {
    enableGas();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", window.location.origin);
    window.history.replaceState({}, "", "/talks/ai-president-intro/result/?utm_source=partner&utm_medium=email&utm_campaign=launch");
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://conference.example/program?visitor=private",
    });
    const user = userEvent.setup();
    const receipt = deferred<typeof savedReceipt>();
    let onConfirming: (() => void) | undefined;
    submitAndConfirmLeadMock.mockImplementation((_lead, options: { onConfirming?: () => void }) => {
      onConfirming = options.onConfirming;
      return receipt.promise;
    });
    render(<LeadForm
      {...baseProps}
      intent="download"
      downloadUrl="/downloads/action-sheet.pdf"
      additionalDownloads={[{ label: "講演資料をダウンロード", url: "/downloads/deck.pdf" }]}
    />);

    expect(screen.queryByText(preparationMessage)).toBeNull();
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
    expect(document.querySelector('input[name="website"]')).toBeInTheDocument();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));

    expect(screen.getByRole("button", { name: "送信中…" })).toBeDisabled();
    expect(submitAndConfirmLeadMock).toHaveBeenCalledOnce();
    const [lead, options] = submitAndConfirmLeadMock.mock.calls[0] as [
      Record<string, unknown>,
      {
        allowLoopbackEndpoint?: boolean;
        endpoint: string;
        onConfirming?: () => void;
        signal?: AbortSignal;
      },
    ];
    expect(lead).toEqual({
      intent: "download",
      companyName: "THA株式会社",
      name: "西山朝子",
      email: "asako@example.com",
      consent: true,
      talkSlug: baseProps.talkSlug,
      eventName: baseProps.eventName,
      diagnosisStage: "experiment",
      referrer: "https://conference.example/program",
      utmSource: "partner",
      utmMedium: "email",
      utmCampaign: "launch",
    });
    expect(lead).not.toHaveProperty("website");
    expect(lead).not.toHaveProperty("answers");
    expect(lead).not.toHaveProperty("score");
    expect(options.endpoint).toBe(endpoint);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.allowLoopbackEndpoint).toBe(true);
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();

    act(() => { onConfirming?.(); });
    expect(screen.getByRole("button", { name: "保存を確認中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存を確認中…" }))
      .toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();

    await act(async () => { receipt.resolve(savedReceipt); });
    const success = await screen.findByRole("status");
    expect(success).toHaveFocus();
    expect(screen.getByRole("link", { name: "資料をダウンロード" }))
      .toHaveAttribute("href", "/downloads/action-sheet.pdf");
    expect(screen.getByRole("link", { name: "資料をダウンロード" })).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "講演資料をダウンロード" }))
      .toHaveAttribute("href", "/downloads/deck.pdf");
    expect(screen.getByRole("link", { name: "講演資料をダウンロード" })).toHaveAttribute("download");
  });

  it.each([
    [new GasNotFoundError(), "保存を確認できませんでした。確認メールが届いていない場合は、もう一度お試しください。"],
    [new GasTimeoutError(), "保存を確認できませんでした。確認メールが届いていない場合は、もう一度お試しください。"],
    [new GasTransportError(), "通信に失敗しました。接続を確認して、もう一度お試しください。"],
  ])("never reveals a download when receipt confirmation fails", async (failure, message) => {
    enableGas();
    const user = userEvent.setup();
    submitAndConfirmLeadMock.mockRejectedValue(failure);
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
    expect(screen.getByRole("button", { name: "資料を受け取る" })).toBeEnabled();
  });

  it("uses a synchronous lock for same-tick submits", async () => {
    enableGas();
    const user = userEvent.setup();
    const receipt = deferred<typeof savedReceipt>();
    submitAndConfirmLeadMock.mockReturnValue(receipt.promise);
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);
    await fillRequiredFields(user);
    const form = screen.getByRole("button", { name: "資料を受け取る" }).closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(submitAndConfirmLeadMock).toHaveBeenCalledOnce();
    await act(async () => { receipt.resolve(savedReceipt); });
    expect(await screen.findByRole("link", { name: "資料をダウンロード" })).toBeVisible();
  });

  it("never invokes the GAS client when the honeypot is populated", async () => {
    enableGas();
    const user = userEvent.setup();
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]');

    expect(honeypot).toBeInTheDocument();
    fireEvent.change(honeypot!, { target: { value: "https://spam.example" } });
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));

    expect(submitAndConfirmLeadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows a recoverable retry as a fresh invocation", async () => {
    enableGas();
    const user = userEvent.setup();
    submitAndConfirmLeadMock
      .mockRejectedValueOnce(new GasNotFoundError())
      .mockResolvedValueOnce(savedReceipt);
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    const firstSignal = (submitAndConfirmLeadMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;

    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));
    expect(await screen.findByRole("link", { name: "資料をダウンロード" })).toBeVisible();
    const secondSignal = (submitAndConfirmLeadMock.mock.calls[1]?.[1] as { signal: AbortSignal }).signal;
    expect(submitAndConfirmLeadMock).toHaveBeenCalledTimes(2);
    expect(secondSignal).not.toBe(firstSignal);
  });

  it("aborts an in-flight receipt check on unmount and ignores a late saved result", async () => {
    enableGas();
    const dataLayer = installDataLayer();
    const user = userEvent.setup();
    const receipt = deferred<typeof savedReceipt>();
    submitAndConfirmLeadMock.mockReturnValue(receipt.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));
    const signal = (submitAndConfirmLeadMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;

    view.unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => { receipt.resolve(savedReceipt); });
    expect(consoleError).not.toHaveBeenCalled();
    expect(dataLayer).toEqual([]);
  });

  it("aborts and resets an in-flight receipt check when intent changes", async () => {
    enableGas();
    const user = userEvent.setup();
    const receipt = deferred<typeof savedReceipt>();
    submitAndConfirmLeadMock.mockReturnValue(receipt.promise);
    const view = render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));
    const signal = (submitAndConfirmLeadMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;

    view.rerender(<LeadForm {...baseProps} intent="consultation" />);

    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () => { receipt.resolve(savedReceipt); });
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
    expect(screen.queryByText("お申し込みを受け付けました。")).toBeNull();
    expect(screen.getByRole("button", { name: "相談を申し込む" })).toBeEnabled();
  });

  it("keeps local field errors accessible and focuses the first invalid control", async () => {
    enableGas();
    const user = userEvent.setup();
    render(<LeadForm {...baseProps} intent="consultation" />);

    await user.click(screen.getByRole("button", { name: "相談を申し込む" }));

    expect(await screen.findByText("会社名を入力してください。")).toBeVisible();
    expect(screen.getByLabelText("会社名")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("会社名")).toHaveAttribute("aria-describedby", "consultation-companyName-error");
    expect(screen.getByRole("group", { name: "相談したいテーマ" }))
      .toHaveAttribute("aria-describedby", "consultation-consultationTopic-error");
    expect(document.activeElement).toBe(screen.getByLabelText("会社名"));
    expect(submitAndConfirmLeadMock).not.toHaveBeenCalled();
  });

  it("submits the selected consultation topic and reports only Sheet persistence", async () => {
    enableGas();
    const user = userEvent.setup();
    submitAndConfirmLeadMock.mockResolvedValue(savedReceipt);
    render(<LeadForm {...baseProps} intent="consultation" thankYouMessage="ご相談を承りました。" />);

    expect(screen.getByLabelText("お名前（任意）")).not.toBeRequired();
    await fillRequiredFields(user);
    await user.click(screen.getByLabelText("AI社長について相談したい"));
    await user.click(screen.getByRole("button", { name: "相談を申し込む" }));

    const success = await screen.findByRole("status");
    expect(success).toHaveTextContent("ご相談を承りました。");
    expect(success).not.toHaveTextContent(/メール|Slack|通知|送信済み/);
    expect(submitAndConfirmLeadMock.mock.calls[0]?.[0]).toMatchObject({
      intent: "consultation",
      consultationTopic: "ai-president",
      diagnosisStage: "experiment",
    });
  });

  it.each([
    "//evil.example/file.pdf",
    "https://evil.example/file.pdf",
    "https://user:password@localhost/downloads/file.pdf",
    "/\\\\evil.example/file.pdf",
    "/downloads/file.pdf?visitor=private",
    "/downloads/file.txt",
  ])("rejects an unsafe configured download without submitting: %s", (downloadUrl) => {
    enableGas();
    render(<LeadForm {...baseProps} intent="download" downloadUrl={downloadUrl} />);
    const button = screen.getByRole("button", { name: "資料を受け取る" });

    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(submitAndConfirmLeadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
  });

  it("rejects downloads when the configured site origin differs from the browser", () => {
    enableGas();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://public.example");
    render(<LeadForm {...baseProps} intent="download" downloadUrl="/downloads/action-sheet.pdf" />);

    expect(screen.getByRole("button", { name: "資料を受け取る" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
  });

  it("emits only the anonymous success event after saved", async () => {
    enableGas();
    const dataLayer = installDataLayer();
    const user = userEvent.setup();
    const receipt = deferred<typeof savedReceipt>();
    submitAndConfirmLeadMock.mockReturnValue(receipt.promise);
    render(<LeadForm
      {...baseProps}
      talkSlug="analytics-task-three"
      intent="download"
      downloadUrl="/downloads/action-sheet.pdf"
    />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));

    expect(dataLayer).toEqual([]);
    await act(async () => { receipt.resolve(savedReceipt); });
    await screen.findByRole("link", { name: "資料をダウンロード" });

    expect(dataLayer).toEqual([{
      event: "download_submit_success",
      talkSlug: "analytics-task-three",
      resultStage: "experiment",
    }]);
    const serializedDataLayer = JSON.stringify(dataLayer);
    expect(serializedDataLayer).not.toMatch(/THA株式会社|西山朝子/);
    expect(serializedDataLayer).not.toContain(submittedEmail);
  });

  it("keeps a verified saved receipt successful when the analytics sink throws", async () => {
    enableGas();
    const dataLayer: Array<Record<string, unknown>> = [];
    Object.freeze(dataLayer);
    (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer = dataLayer;
    const user = userEvent.setup();
    submitAndConfirmLeadMock.mockResolvedValue(savedReceipt);
    render(<LeadForm
      {...baseProps}
      talkSlug="analytics-frozen-sink"
      intent="download"
      downloadUrl="/downloads/action-sheet.pdf"
    />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "資料を受け取る" }));

    expect(await screen.findByRole("link", { name: "資料をダウンロード" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitAndConfirmLeadMock).toHaveBeenCalledOnce();
    expect(dataLayer).toEqual([]);
  });

  it("uses visible consent text and a safe privacy-policy link", () => {
    enableGas();
    render(<LeadForm {...baseProps} intent="download" />);

    expect(screen.getByText(baseProps.consentText)).toBeVisible();
    expect(screen.getByRole("link", { name: "プライバシーポリシー" }))
      .toHaveAttribute("href", baseProps.privacyPolicyUrl);
  });

  it("uses the approved environment privacy URL instead of Talk content", () => {
    vi.stubEnv("NEXT_PUBLIC_GAS_WEB_APP_URL", endpoint);
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_POLICY_URL", "https://approved.example/privacy");
    render(<LeadForm {...baseProps} privacyPolicyUrl="https://content.example/privacy" intent="consultation" />);

    expect(screen.getByRole("link", { name: "プライバシーポリシー" }))
      .toHaveAttribute("href", "https://approved.example/privacy");
  });

  it("does not invent a privacy-policy fallback for an unsafe activation pair", () => {
    vi.stubEnv("NEXT_PUBLIC_GAS_WEB_APP_URL", endpoint);
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_POLICY_URL", "javascript:alert(1)");
    render(<LeadForm {...baseProps} privacyPolicyUrl={undefined} intent="consultation" />);

    expect(screen.getByText(preparationMessage)).toBeVisible();
    expect(screen.queryByRole("link", { name: "プライバシーポリシー" })).toBeNull();
    expect(screen.getByRole("button", { name: "相談を申し込む" })).toBeDisabled();
  });
});
