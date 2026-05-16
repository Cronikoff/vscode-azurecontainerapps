/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, nonNullProp, type IAzureQuickPickItem, type IWizardOptions } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../../extensionVariables";
import { localize } from "../../../../utils/localize";
import { type DeploymentConfigurationSettings } from "../../settings/DeployWorkspaceProjectSettingsV2";
import { dwpSettingUtilsV2 } from "../../settings/dwpSettingUtilsV2";
import { type WorkspaceDeploymentConfigurationContext } from "./WorkspaceDeploymentConfigurationContext";
import { ContainerAppVerifyStep } from "./azureResources/ContainerAppVerifyStep";
import { ContainerRegistryVerifyStep } from "./azureResources/ContainerRegistryVerifyStep";
import { ResourceGroupVerifyStep } from "./azureResources/ResourceGroupVerifyStep";
import { DockerfileValidateStep } from "./filePaths/DockerfileValidateStep";
import { EnvUseRemoteConfigurationPromptStep } from "./filePaths/EnvUseRemoteConfigurationPromptStep";
import { EnvValidateStep } from "./filePaths/EnvValidateStep";
import { SrcValidateStep } from "./filePaths/SrcValidateStep";

const CONTAINER_APP_WEIGHT: number = 3;
const RESOURCE_GROUP_WEIGHT: number = 2;
const CONTAINER_REGISTRY_WEIGHT: number = 1;
const DOCKERFILE_PATH_WEIGHT: number = 1;
const SOURCE_PATH_WEIGHT: number = 1;
const ENV_PATH_WEIGHT: number = 1;
const CREATOR_SIGNATURE_WEIGHT: number = 2;

interface ScoredConfiguration {
    deploymentConfiguration: DeploymentConfigurationSettings;
    configurationIdx: number;
    score: number;
}

export class DeploymentConfigurationListStep extends AzureWizardPromptStep<WorkspaceDeploymentConfigurationContext> {
    public async prompt(context: WorkspaceDeploymentConfigurationContext): Promise<void> {
        const deploymentConfigurations: DeploymentConfigurationSettings[] | undefined = await dwpSettingUtilsV2.getWorkspaceDeploymentConfigurations(nonNullProp(context, 'rootFolder'));
        if (!deploymentConfigurations?.length) {
            return;
        }

        const pick = await context.ui.showQuickPick(this.getPicks(deploymentConfigurations), {
            placeHolder: localize('chooseDeployConfigurationSetting', 'Select an app configuration to deploy'),
            suppressPersistence: true,
        });

        context.deploymentConfigurationSettings = pick.data;
        context.configurationIdx = pick.data?.configurationIdx;
    }

    public shouldPrompt(context: WorkspaceDeploymentConfigurationContext): boolean {
        return !context.deploymentConfigurationSettings;
    }

    public async getSubWizard(context: WorkspaceDeploymentConfigurationContext): Promise<IWizardOptions<WorkspaceDeploymentConfigurationContext> | undefined> {
        if (!context.deploymentConfigurationSettings) {
            ext.outputChannel.appendLog(localize('createNewAppConfiguration', 'User chose to create a new app configuration.'));
            return undefined;
        }

        if (context.deploymentConfigurationSettings.label) {
            ext.outputChannel.appendLog(localize('choseExistingConfiguration', 'User chose to load existing workspace deployment configuration "{0}".', context.deploymentConfigurationSettings.label));
        } else {
            ext.outputChannel.appendLog(localize('choseExistingConfiguration', 'User chose to load existing workspace deployment configuration.'));
        }

        // We mainly want to show activity children if there are deployment settings to verify
        context.activityChildren ??= [];

        return {
            promptSteps: [
                new EnvUseRemoteConfigurationPromptStep(),
            ],
            executeSteps: [
                new DockerfileValidateStep(),
                new SrcValidateStep(),
                new EnvValidateStep(),
                new ResourceGroupVerifyStep(),
                new ContainerAppVerifyStep(),
                new ContainerRegistryVerifyStep()
            ]
        };
    }

    private getPicks(deploymentConfigurations: DeploymentConfigurationSettings[]): IAzureQuickPickItem<(DeploymentConfigurationSettings & { configurationIdx?: number }) | undefined>[] {
        const scoredConfigurations: ScoredConfiguration[] = deploymentConfigurations
            .map((deploymentConfiguration, i) => ({
                deploymentConfiguration,
                configurationIdx: i,
                score: this.calculateConfigurationScore(deploymentConfiguration)
            }))
            .sort((a, b) => {
                const scoreDifference: number = b.score - a.score;
                return scoreDifference !== 0 ? scoreDifference : a.configurationIdx - b.configurationIdx;
            });

        const recommendedConfigurationIdx: number | undefined = scoredConfigurations[0]?.score > 0 ? scoredConfigurations[0].configurationIdx : undefined;
        const picks: IAzureQuickPickItem<DeploymentConfigurationSettings | undefined>[] = scoredConfigurations.map(({ deploymentConfiguration, configurationIdx }) => {
            const isRecommended: boolean = configurationIdx === recommendedConfigurationIdx;
            const label: string = deploymentConfiguration.label || localize('unnamedApp', 'Unnamed app');
            const containerAppDescription: string | undefined = deploymentConfiguration.label === deploymentConfiguration.containerApp ? undefined : deploymentConfiguration.containerApp;
            const creatorDescription: string | undefined = deploymentConfiguration.creatorSignature ? localize('creatorSignatureDescription', 'creator: @{0}', deploymentConfiguration.creatorSignature) : undefined;
            const descriptionParts: string[] = [containerAppDescription, creatorDescription].filter((part): part is string => !!part);
            const description: string | undefined = descriptionParts.length > 0 ? descriptionParts.join(' • ') : undefined;

            return {
                label: isRecommended ? localize('recommendedDeploymentConfigurationLabel', '$(star-full) {0} (recommended)', label) : label,
                description,
                data: { ...deploymentConfiguration, configurationIdx }
            };
        });

        picks.push({
            label: localize('createDeploymentConfiguration', '$(plus) Create and deploy new app configuration'),
            data: undefined
        });

        return picks;
    }

    private calculateConfigurationScore(deploymentConfiguration: DeploymentConfigurationSettings): number {
        let score: number = 0;

        if (deploymentConfiguration.containerApp) {
            score += CONTAINER_APP_WEIGHT;
        }

        if (deploymentConfiguration.resourceGroup) {
            score += RESOURCE_GROUP_WEIGHT;
        }

        if (deploymentConfiguration.containerRegistry) {
            score += CONTAINER_REGISTRY_WEIGHT;
        }

        if (deploymentConfiguration.dockerfilePath) {
            score += DOCKERFILE_PATH_WEIGHT;
        }

        if (deploymentConfiguration.srcPath) {
            score += SOURCE_PATH_WEIGHT;
        }

        if (deploymentConfiguration.envPath) {
            score += ENV_PATH_WEIGHT;
        }

        if (deploymentConfiguration.creatorSignature) {
            score += CREATOR_SIGNATURE_WEIGHT;
        }

        return score;
    }
}
