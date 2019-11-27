import * as Constants from "./Constants";
import { RestClient } from "./RestClient";
import { sleep } from "./Utils";

export default interface SkillPriority {
    skillNumber: number,
    skillPriority: number
}

export class AgentClient {

    private restClient: RestClient
    private subAccountId: string

    constructor(subAccountId: string, restClient: RestClient) {
        this.restClient = restClient
        this.subAccountId = subAccountId
    }
    /**
     * TODO: verify input
     * @param agent_username 
     * @param agent_password 
     * @param skillsWithPriority 
     */
    public async createAgent(agent_username: string, agent_password: string, skillsWithPriority: [SkillPriority]) {

        // todo: pass it in to reuse
        let agentStationGroupId = await this.restClient.getAgentStationGroupId(this.subAccountId);
        if (agentStationGroupId < 0) {
            throw new Error(`subAccount ${this.subAccountId} has no agent station group defined`)
        }

        let agentLoginId = await this.restClient.getNextAvailableExtension(this.subAccountId, 'AGENT');
        if (agentLoginId < 0) {
            throw new Error(`subAccount ${this.subAccountId} has no available agent extension`)
        }
        // todo: pass it in to reuse
        let skillIds = await this.getSkillIds();
        if (skillIds.length == 0) {
            throw new Error(`subAccount ${this.subAccountId} has no skills`)
        }

        await this.sendCreateAgentRequest(
            agent_username,
            agent_password,
            agentStationGroupId,
            agentLoginId,
            skillIds, skillsWithPriority
        );

        // wait until agent is created
        await this.waitForAgentCreation(agentLoginId);

        let stationExtension = await this.restClient.getNextAvailableExtension(this.subAccountId, 'STATION');
        if (stationExtension < 0) {
            throw new Error(`subAccount ${this.subAccountId} has station extensions available`)
        }

        await this.sendCreateStationRequest(
            agentStationGroupId,
            this.subAccountId,
            stationExtension,
            agent_username
        );

        // wait until station is created
        await this.waitForStationCreation(agent_username);
        return this.getAgent(agent_username);
    }

    async sendCreateAgentRequest(
        agent_username: string,
        agent_password: string,
        agentStationGroupId: any,
        agentLoginId: any,
        skillIds: any, skillsWithPriority: [SkillPriority]) {

        let securityCode = this.generateSecurityCode(agentLoginId);
        let avayaPassword = this.generateAvayaPassword(agentLoginId);
        let agent = {
            "username": agent_username,
            "firstName": Constants.AGENT_FIRST_NAME,
            "lastName": Constants.AGENT_LAST_NAME,
            "password": agent_password,
            "loginId": agentLoginId,
            "agentStationGroupId": agentStationGroupId,
            "securityCode": securityCode,
            "startDate": "2019-03-21",
            "endDate": "2038-01-01",
            "avayaPassword": avayaPassword,
            "clientId": this.subAccountId,
            "skillIds": skillIds,
            "agentSkills": skillsWithPriority,
            // no supervisors
            "supervisorId": 0,
            // channel 1 is voice
            "channelIds": [1]
        };

        return this.restClient.createAgentJob(agent)
    }

    generateAvayaPassword(agentLoginId: { toString: () => any }) {
        let agentLoginIdString = agentLoginId.toString();
        let length = agentLoginIdString.length;
        // substring(starting_index, ending_index), negative starting_index is treated as 0 
        return agentLoginIdString.substring(length - 6, length);
    }

    generateSecurityCode(agentLoginId: { toString: () => any }) {
        let agentLoginIdString = agentLoginId.toString();
        let length = agentLoginIdString.length;
        // substring(starting_index, ending_index), negative starting_index is treated as 0 
        return agentLoginIdString.substring(length - 4, length);
    }


    getSkillIds(): Promise<[]> {
        return this.restClient.getSubAccountAgentSkills(this.subAccountId)
            .then((response: { data: { [x: string]: { [x: string]: any } } }) => {
                // console.log(response)
                let skillResponses = response.data['skillResponses'][this.subAccountId];
                return skillResponses.map((skillResponse: { id: any }) => skillResponse.id);
            })

    }

    getSkillNumbers() {
        return this.restClient.getSubAccountAgentSkills(this.subAccountId)
            .then((response: { data: { [x: string]: { [x: string]: any } } }) => {
                let skillResponses = response.data['skillResponses'][this.subAccountId];
                const availableSkills = [];
                for (let skill of skillResponses) {
                    let skillInfo = {
                        "skillNumber": skill.number,
                        "skillName": skill.name,
                    };
                    availableSkills.push(skillInfo);
                }
                console.log(availableSkills);
                return availableSkills;
            })
    }

    sendCreateStationRequest(
        agentStationGroupId: any,
        subAccountId: any,
        stationExtension: { toString: () => any },
        agentUsername: string) {

        let securityCode = this.generateSecurityCode(stationExtension);

        let station = {
            "agentStationGroupId": agentStationGroupId,
            "clientId": subAccountId,
            "extension": stationExtension,
            "name": Constants.STATION_NAME,
            "securityCode": securityCode,
            "username": agentUsername
        };

        return this.restClient.createStationJob(station)
    }

    async getAgent(agentUsername: string) {
        let agent = {};
        try {
            agent = await this.restClient.getAgentByUsername(agentUsername)
        } catch (e) {
            if (e.response.status === 404) {
                console.log('agent ' + agentUsername + ' not found')
            } else {
                throw e
            }
        }

        let station = {};
        try {
            station = await this.restClient.getStationForAgent(this.subAccountId, agentUsername);
            if (!station) {
                console.log('station associated with ' + agentUsername + ' not found');
                station = {}
            }
        } catch (e) {
            if (e.response.status === 404) {
                console.log('station associated with ' + agentUsername + ' not found')
            } else {
                throw e
            }
        }

        return { 'agent': agent, 'station': station }
    }

    existsAgentByLoginId(loginId: number) {
        let promise = this.restClient.getAgentByLoginId(loginId)
        return this.checkAgentPromise(promise)
    }
    existsAgentByUsername(username: string) {
        let promise = this.restClient.getAgentByUsername(username)
        return this.checkAgentPromise(promise)
    }
    checkAgentPromise(promise: Promise<any>): Promise<boolean> {
        return promise
            .then(agent => {
                return true
            })
            .catch(error => {
                return false
            }
            )
    }

    private async repeat(callback: () => Promise<boolean>) {
        return this.redo(callback, Constants.MAX_RETRY, Constants.INTERVAL_IN_MILLIS)
    }
    /*
    call back need to always resolve to either true or false
    */
    async redo(callback: () => Promise<boolean>, retries: number, millis:number) {
        console.log(`entering redo ${retries}`)
        for (let count = 0; count < retries; count++) {

            let result = await callback()
            console.log(`count=${count}result=${result}`)
            if (result) {
                return true
            }
            sleep(millis)
        }
        return false
    }
    

    async waitForAgentCreation(loginId: number) {
        let callback = () => {
            return this.existsAgentByLoginId(loginId)
        }
        return this.repeat(callback)
    }

    async waitForAgentDeletion(agent_username: string) {
        let callback = () => {
            return this.existsAgentByUsername(agent_username)
                .then(result => !result)
        }
        return this.repeat(callback)
    }

    async waitForStationCreation(agent_username: string) {
        let callback = () => {
            return this.restClient
                .getStationForAgent(this.subAccountId, agent_username)
                .then((station: any) => station !== undefined)
        }
        return this.repeat(callback)
    }

    async waitForStationDeletion(agent_username: string) {
        let callback = () => {
            return this.restClient
                .getStationForAgent(this.subAccountId, agent_username)
                .then((station: any) => station === undefined)
        }
        return this.repeat(callback)
    }

    async deleteAgent(agentUsername: string) {

        let station = await this.restClient.getStationForAgent(this.subAccountId, agentUsername);
        // station might have been deleted before, so station might be undefined
        if (station) {
            await this.restClient.requestStationDeletion(station.id);
            await this.waitForStationDeletion(agentUsername)
        } else {
            console.log('station associated with ' + agentUsername + ' has already been deleted')
        }

        try {
            let agent = await this.restClient.getAgentByUsername(agentUsername);
            let submitted = await this.restClient.requestAgentDeletion(agentUsername, agent.loginId);
            if (submitted) {
                await this.waitForAgentDeletion(agentUsername);
            }
        } catch (e) {
            if (e.response.status === 404) {
                console.log('agent ' + agentUsername + ' has already been deleted')
            } else {
                throw e
            }
        }
    }
}
export async function createAgentClient(restClient: RestClient): Promise<AgentClient> {
    let subAccountId = await restClient.getSubAccountId()
    return new AgentClient(subAccountId, restClient);

}
