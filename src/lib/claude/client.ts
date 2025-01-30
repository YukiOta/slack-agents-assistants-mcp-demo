import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export const getClient = async () => {
  const credentials = await fromNodeProviderChain({
    profile: process.env.AWS_SSO_PROFILE,
  })();

  return new AnthropicBedrock({
    awsAccessKey: credentials.accessKeyId,
    awsSecretKey: credentials.secretAccessKey,
    awsSessionToken: credentials.sessionToken,
    awsRegion: "ap-northeast-1",
  });
};
