/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStepWithActivityOutput, nonNullProp, nonNullValueAndProp } from "@microsoft/vscode-azext-utils";
import { getGitHubAccessToken, gitHubUrlParse } from "@microsoft/vscode-azext-github";
import * as path from "path";
import { type Progress, type WorkspaceFolder, workspace } from "vscode";
import { relativeSettingsFilePath } from "../../../constants";
import { localize } from "../../../utils/localize";
import { getContainerAppSourceControl } from "../../gitHub/connectToGitHub/getContainerAppSourceControl";
import { useRemoteConfigurationKey } from "../deploymentConfiguration/workspace/filePaths/EnvUseRemoteConfigurationPromptStep";
import { type DeploymentConfigurationSettings } from "../settings/DeployWorkspaceProjectSettingsV2";
import { dwpSettingUtilsV2 } from "../settings/dwpSettingUtilsV2";
import { type DeployWorkspaceProjectInternalContext } from "./DeployWorkspaceProjectInternalContext";

const GITHUB_USER_API_URL: string = 'https://api.github.com/user';
const GITHUB_USER_AGENT: string = 'vscode-azurecontainerapps (https://github.com/microsoft/vscode-azurecontainerapps)';
const GITHUB_USER_REQUEST_TIMEOUT_MS: number = 5000;

interface GitHubUserResponse {
    login?: string;
}

export class DeployWorkspaceProjectSaveSettingsStep<T extends DeployWorkspaceProjectInternalContext> extends AzureWizardExecuteStepWithActivityOutput<T> {
    public priority: number = 1480;
    public stepName: string = 'deployWorkspaceProjectSaveSettingsStepItem';
    protected getOutputLogSuccess = () => localize('savedSettingsSuccess', 'Saved deployment settings to workspace "{0}".', relativeSettingsFilePath);
    protected getOutputLogFail = () => localize('savedSettingsFail', 'Failed to save deployment settings to workspace "{0}".', relativeSettingsFilePath);
    protected getTreeItemLabel = () => localize('saveSettingsLabel', 'Save deployment settings to workspace "{0}"', relativeSettingsFilePath);

    public async execute(context: DeployWorkspaceProjectInternalContext, progress: Progress<{ message?: string | undefined; increment?: number | undefined }>): Promise<void> {
        this.options.continueOnFail = true;
        progress.report({ message: localize('saving', 'Saving configuration...') });

        const rootFolder: WorkspaceFolder = nonNullProp(context, 'rootFolder');
        const deploymentConfigurations: DeploymentConfigurationSettings[] = await dwpSettingUtilsV2.getWorkspaceDeploymentConfigurations(rootFolder) ?? [];

        const configurationLabel: string | undefined = context.configurationIdx !== undefined ? deploymentConfigurations?.[context.configurationIdx].label : undefined;
        const deploymentConfiguration: DeploymentConfigurationSettings = {
            label: configurationLabel || nonNullValueAndProp(context.containerApp, 'name'),
            type: 'AcrDockerBuildRequest',
            dockerfilePath: path.relative(rootFolder.uri.fsPath, nonNullProp(context, 'dockerfilePath')),
            srcPath: path.relative(rootFolder.uri.fsPath, context.srcPath || rootFolder.uri.fsPath) || ".",
            envPath: this.getEnvPath(rootFolder, context.envPath),
            resourceGroup: context.resourceGroup?.name,
            containerApp: context.containerApp?.name,
            containerRegistry: context.registry?.name,
        };

        if (workspace.getConfiguration('containerApps').get<boolean>('includeCreatorSignature', true)) {
            const creatorSignature: string | undefined = await this.getCreatorSignature(context);
            if (creatorSignature) {
                deploymentConfiguration.creatorSignature = creatorSignature;
            }
        }

        if (context.configurationIdx !== undefined) {
            deploymentConfigurations[context.configurationIdx] = deploymentConfiguration;
        } else {
            deploymentConfigurations.push(deploymentConfiguration);
        }

        await dwpSettingUtilsV2.setWorkspaceDeploymentConfigurations(rootFolder, deploymentConfigurations);
    }

    public shouldExecute(context: DeployWorkspaceProjectInternalContext): boolean {
        return !!context.shouldSaveDeploySettings;
    }

    private getEnvPath(rootFolder: WorkspaceFolder, envPath: string | undefined): string {
        if (envPath === undefined) {
            return '';
        } else if (envPath === '') {
            return useRemoteConfigurationKey;
        } else {
            return path.relative(rootFolder.uri.fsPath, envPath);
        }
    }

    private async getCreatorSignature(context: DeployWorkspaceProjectInternalContext): Promise<string | undefined> {
        if (!context.containerApp) {
            return undefined;
        }

        try {
            const sourceControl = await getContainerAppSourceControl(context, context.subscription, context.containerApp);
            if (!sourceControl?.repoUrl) {
                return undefined;
            }

            try {
                gitHubUrlParse(sourceControl.repoUrl);
            } catch {
                return undefined;
            }

            const token: string = await getGitHubAccessToken();
            const headers = new Headers();
            headers.set('Authorization', `Bearer ${token}`);
            headers.set('Accept', 'application/vnd.github+json');
            headers.set('User-Agent', GITHUB_USER_AGENT);
            const response = await fetch(GITHUB_USER_API_URL, {
                headers,
                signal: AbortSignal.timeout(GITHUB_USER_REQUEST_TIMEOUT_MS),
            });

            if (!response.ok) {
                return undefined;
            }

            const user: GitHubUserResponse = await response.json() as GitHubUserResponse;
            return user.login;
        } catch {
            return undefined;
        }
    }
}
